import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * End-to-end encryption for chat text.
 *
 * Every user holds an ECDH P-256 key pair; the private key never leaves the
 * browser (localStorage). Each conversation has a random AES-GCM conversation
 * key which is wrapped (encrypted) for every member with the pairwise ECDH
 * key, stored in `conversation_keys`. Message bodies are stored as
 * "enc:<iv-b64>:<ciphertext-b64>" and can only be decrypted by conversation
 * members holding their private key.
 */

const PREFIX = "enc:";
const privStore = (uid: string) => `sa-e2ee-priv-${uid}`;

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function pack(iv: Uint8Array, ct: ArrayBuffer): string {
  return `${PREFIX}${toB64(iv)}:${toB64(ct)}`;
}
function unpack(stored: string): { iv: Uint8Array<ArrayBuffer>; data: Uint8Array<ArrayBuffer> } | null {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "enc") return null;
  try {
    return { iv: fromB64(parts[1] ?? ""), data: fromB64(parts[2] ?? "") };
  } catch {
    return null;
  }
}

const subtle = () => crypto.subtle;
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

/**
 * Ensures the signed-in user has an E2EE key pair and uploads the public key
 * to their profile. Concurrent callers share one run: two parallel runs on an
 * empty browser would each generate a key pair and the second would overwrite
 * the first's private key while the profile kept the first's public key —
 * every pairwise unwrap would then fail. The re-check loop also repairs a
 * private key that another open tab overwrote mid-run.
 */
const ensureInflight = new Map<string, Promise<void>>();
export function ensureMyKeys(userId: string): Promise<void> {
  const existing = ensureInflight.get(userId);
  if (existing) return existing;
  const p = (async () => {
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        let stored = localStorage.getItem(privStore(userId));
        if (!stored) {
          const pair = await subtle().generateKey(ECDH, true, ["deriveKey"]);
          localStorage.setItem(privStore(userId), JSON.stringify(await subtle().exportKey("jwk", pair.privateKey)));
          stored = localStorage.getItem(privStore(userId));
        }
        const jwk = JSON.parse(stored!) as JsonWebKey;
        console.debug("[e2ee] my priv pub-x", jwk.x?.slice(0, 8), "user", userId.slice(0, 8));
        const pubJwk = JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true });
        const { data } = await supabase.from("profiles").select("public_key").eq("id", userId).maybeSingle();
        if (data && data.public_key !== pubJwk) {
          await supabase.from("profiles").update({ public_key: pubJwk }).eq("id", userId);
        }
        // Another tab may have replaced the private key while we uploaded the
        // matching public key — converge on whatever is stored now.
        if (localStorage.getItem(privStore(userId)) === stored) return;
      }
    } catch {
      // E2EE unavailable; messages fall back to plaintext transport
    }
  })();
  ensureInflight.set(userId, p);
  p.catch(() => ensureInflight.delete(userId));
  return p;
}

// Key derivation must never run against a stale profile public key (e.g. the
// wrap created before this browser uploaded its current key), so every
// derive/encrypt/decrypt path awaits this memoized promise first.
const ensureMemo = new Map<string, Promise<void>>();
function ensureMyKeysOnce(userId: string): Promise<void> {
  let p = ensureMemo.get(userId);
  if (!p) {
    p = ensureMyKeys(userId).catch(() => undefined);
    ensureMemo.set(userId, p);
  }
  return p;
}

const privCache = new Map<string, Promise<CryptoKey>>();
function myPrivateKey(userId: string): Promise<CryptoKey> {
  let p = privCache.get(userId);
  if (!p) {
    p = subtle().importKey(
      "jwk",
      JSON.parse(localStorage.getItem(privStore(userId))!) as JsonWebKey,
      ECDH,
      true,
      ["deriveKey"],
    );
    privCache.set(userId, p);
  }
  return p;
}

const pairCache = new Map<string, Promise<CryptoKey>>();
async function pairKey(userId: string, peerJwk: JsonWebKey): Promise<CryptoKey> {
  const cacheKey = `${userId}:${peerJwk.x}:${peerJwk.y}`;
  console.debug("[e2ee] pairKey me", userId.slice(0, 8), "peer-x", peerJwk.x?.slice(0, 8));
  let p = pairCache.get(cacheKey);
  if (!p) {
    const pub = await subtle().importKey("jwk", peerJwk, ECDH, false, []);
    p = subtle().deriveKey({ name: "ECDH", public: pub }, await myPrivateKey(userId), { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    pairCache.set(cacheKey, p);
  }
  return p;
}

const convKeyCache = new Map<string, Promise<CryptoKey | null>>();

// Live convergence: when a member rotates the conversation key (e.g. after
// signing in on a new device), every other open page re-derives immediately
// instead of staying on the stale cached key until a reload.
const keysyncChannels = new Map<string, RealtimeChannel>();
function keysyncChannel(conversationId: string): RealtimeChannel {
  let ch = keysyncChannels.get(conversationId);
  if (!ch) {
    ch = supabase
      .channel(`keysync-${conversationId}`)
      .on("broadcast", { event: "rotated" }, () => {
        convKeyCache.delete(conversationId);
        window.dispatchEvent(new CustomEvent("conv-key-rotated", { detail: { conversationId } }));
      })
      .subscribe();
    keysyncChannels.set(conversationId, ch);
  }
  return ch;
}

function broadcastRotation(conversationId: string) {
  const ch = keysyncChannel(conversationId);
  const send = () => void ch.send({ type: "broadcast", event: "rotated" });
  if (ch.state === "joined") {
    send();
    return;
  }
  // The channel is still subscribing — deliver as soon as it joins.
  const started = Date.now();
  const timer = setInterval(() => {
    if (ch.state === "joined") {
      clearInterval(timer);
      send();
    } else if (Date.now() - started > 15000) {
      clearInterval(timer);
    }
  }, 250);
}

async function memberPublicKeys(conversationId: string): Promise<Map<string, JsonWebKey | null>> {
  const { data, error } = await supabase
    .from("conversation_members")
    .select("user_id, profiles(public_key)")
    .eq("conversation_id", conversationId);
  if (error) console.debug("[e2ee] members query error", error.message);
  const map = new Map<string, JsonWebKey | null>();
  for (const row of (data ?? []) as { user_id: string; profiles: { public_key: string | null } | null }[]) {
    const raw = row.profiles?.public_key ?? null;
    map.set(row.user_id, raw ? (JSON.parse(raw) as JsonWebKey) : null);
  }
  console.debug("[e2ee] members for", conversationId.slice(0, 8), [...map.entries()].map(([u, k]) => `${u.slice(0, 8)}:${k ? k.x?.slice(0, 6) : "null"}`).join(" "));
  return map;
}

async function unwrapKey(
  userId: string,
  peerJwk: JsonWebKey,
  stored: string,
): Promise<CryptoKey | null> {
  const packed = unpack(stored);
  if (!packed) return null;
  try {
    const pk = await pairKey(userId, peerJwk);
    const raw = await subtle().decrypt({ name: "AES-GCM", iv: packed.iv }, pk, packed.data);
    return await subtle().importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
  } catch (err) {
    console.debug("[e2ee] unwrap error", (err as Error)?.name, (err as Error)?.message);
    return null;
  }
}

/** Returns the conversation AES key, creating and distributing one when missing. */
export async function getConversationKey(conversationId: string, meId: string): Promise<CryptoKey | null> {
  const cached = convKeyCache.get(conversationId);
  if (cached) return cached;
  const promise = (async () => {
    await ensureMyKeysOnce(meId);
    const members = await memberPublicKeys(conversationId);
    if (!members.has(meId)) {
      console.debug("[e2ee] not a member of", conversationId.slice(0, 8), "as", meId.slice(0, 8));
      return null; // not a member of this conversation
    }
    const { data: conv } = await supabase
      .from("conversations")
      .select("created_by")
      .eq("id", conversationId)
      .maybeSingle();
    const creatorId = (conv as { created_by: string | null } | null)?.created_by ?? meId;
    console.debug("[e2ee] derive conv", conversationId.slice(0, 8), "me", meId.slice(0, 8), "creator", creatorId.slice(0, 8));

    const fetchRows = async () =>
      (
        await supabase
          .from("conversation_keys")
          .select("wrapped_by, wrapped_key, created_at")
          .eq("conversation_id", conversationId)
          .eq("user_id", meId)
          .order("created_at", { ascending: false })
      ).data;

    // Only the conversation creator creates the initial key; other members
    // wait for the creator's wrap instead of racing to rotate their own.
    const attempts = creatorId === meId ? 1 : 5;
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 900));
      const rows = await fetchRows();
      console.debug("[e2ee] attempt", i, "rows", (rows ?? []).length, "for", meId.slice(0, 8));
      // Newest wrap first: after a key rotation everyone converges on the latest key.
      for (const row of (rows ?? []) as { wrapped_by: string; wrapped_key: string }[]) {
        const peer = members.get(row.wrapped_by);
        if (peer) {
          const key = await unwrapKey(meId, peer, row.wrapped_key);
          console.debug("[e2ee] unwrap from", row.wrapped_by.slice(0, 8), key ? "OK" : "FAIL");
          if (key) return key;
        } else {
          console.debug("[e2ee] no peer key for wrapper", row.wrapped_by.slice(0, 8));
        }
      }
    }
    // No row could be unwrapped (e.g. the member's browser keys changed):
    // rotate — create a fresh conversation key and re-wrap it for everyone.
    console.debug("[e2ee] rotate fallback for", meId.slice(0, 8));
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const key = await subtle().importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
    const inserts: { conversation_id: string; user_id: string; wrapped_by: string; wrapped_key: string }[] = [];
    for (const [uid, peer] of members) {
      if (!peer) continue;
      try {
        const pk = await pairKey(meId, peer);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = await subtle().encrypt({ name: "AES-GCM", iv }, pk, raw);
        inserts.push({ conversation_id: conversationId, user_id: uid, wrapped_by: meId, wrapped_key: pack(iv, ct) });
      } catch {
        // member has no usable key yet
      }
    }
    console.debug("[e2ee] rotation inserts", inserts.length, "targets", inserts.map((r) => r.user_id.slice(0, 8)).join(","));
    if (inserts.length) {
      // Insert, never upsert on (conversation_id, user_id, wrapped_by): a
      // member rotating twice would otherwise overwrite their previous
      // generation's wrap — the very row history migration needs to unwrap
      // older messages. Each rotation appends a new generation instead.
      const { error } = await supabase
        .from("conversation_keys")
        .insert(inserts);
      if (error) {
        // Never keep a key that nobody else can obtain — future messages
        // encrypted with it would be unreadable for every other member.
        console.debug("[e2ee] rotation insert error", error.message);
        convKeyCache.delete(conversationId);
        return null;
      }
      broadcastRotation(conversationId);
      return key;
    }
    convKeyCache.delete(conversationId);
    return null;
  })();
  convKeyCache.set(conversationId, promise);
  promise.catch(() => convKeyCache.delete(conversationId));
  return promise;
}

/** Encrypts message text for storage; throws when no conversation key is available. */
export async function encryptText(conversationId: string, meId: string, text: string): Promise<string> {
  const key = await getConversationKey(conversationId, meId);
  if (!key) throw new Error("Encryption keys are not ready — open the app once, then try again");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
  return pack(iv, ct);
}

/** Decrypts a stored message body; null when it cannot be decrypted. */
export async function decryptStoredText(
  conversationId: string,
  meId: string,
  stored: string | null,
): Promise<string | null> {
  if (!stored || !stored.startsWith(PREFIX)) return stored;
  const packed = unpack(stored);
  if (!packed) return null;
  const key = await getConversationKey(conversationId, meId);
  if (key) {
    try {
      return new TextDecoder().decode(
        await subtle().decrypt({ name: "AES-GCM", iv: packed.iv }, key, packed.data),
      );
    } catch {
      // fall through to the retry below
    }
  }
  // The cached key is stale (e.g. a peer rotated on a new device): re-derive
  // once and retry before giving up.
  convKeyCache.delete(conversationId);
  const retryKey = await getConversationKey(conversationId, meId);
  if (!retryKey) return null;
  try {
    const plain = await subtle().decrypt({ name: "AES-GCM", iv: packed.iv }, retryKey, packed.data);
    return new TextDecoder().decode(plain);
  } catch {
    convKeyCache.delete(conversationId); // re-derive on the next attempt
    return null;
  }
}

/**
 * Re-encrypts history that was encrypted with an older conversation key into
 * the current one, so a member who rotated (e.g. signed in on a new device
 * and lost the old private key) can read the older messages again. Only a
 * member who can unwrap an older generation — typically the conversation
 * creator — can do this. Returns the number of migrated messages.
 */
export async function migrateConversationHistory(conversationId: string, meId: string): Promise<number> {
  try {
    const currentKey = await getConversationKey(conversationId, meId);
    if (!currentKey) return 0;
    const currentRaw = toB64(await subtle().exportKey("raw", currentKey));

    const members = await memberPublicKeys(conversationId);
    const { data: keyRows } = await supabase
      .from("conversation_keys")
      .select("wrapped_by, wrapped_key")
      .eq("conversation_id", conversationId)
      .eq("user_id", meId);
    // Older generations only: every key that is not the current one.
    const candidates = new Map<string, CryptoKey>();
    for (const row of (keyRows ?? []) as { wrapped_by: string; wrapped_key: string }[]) {
      const peer = members.get(row.wrapped_by);
      if (!peer) continue;
      const k = await unwrapKey(meId, peer, row.wrapped_key);
      if (!k) continue;
      const raw = toB64(await subtle().exportKey("raw", k));
      if (raw !== currentRaw) candidates.set(raw, k);
    }
    if (!candidates.size) return 0;

    const { data: msgs } = await supabase
      .from("messages")
      .select("id, body")
      .eq("conversation_id", conversationId)
      .like("body", "enc:%")
      .limit(300);
    let migrated = 0;
    for (const m of (msgs ?? []) as { id: string; body: string }[]) {
      const packed = unpack(m.body);
      if (!packed) continue;
      for (const k of candidates.values()) {
        try {
          const plain = await subtle().decrypt({ name: "AES-GCM", iv: packed.iv }, k, packed.data);
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const ct = await subtle().encrypt({ name: "AES-GCM", iv }, currentKey, plain);
          const { error } = await supabase.from("messages").update({ body: pack(iv, ct) }).eq("id", m.id);
          if (!error) migrated++;
          break;
        } catch {
          // try the next older key
        }
      }
    }
    // Tell everyone a history migration happened so open pages re-decrypt.
    if (migrated > 0) broadcastRotation(conversationId);
    console.debug("[e2ee] history migrated", migrated, "messages in", conversationId.slice(0, 8));
    return migrated;
  } catch {
    return 0;
  }
}
