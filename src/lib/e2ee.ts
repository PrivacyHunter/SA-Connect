import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * End-to-end encryption for chat text.
 *
 * Every user holds an ECDH P-256 key pair; the private key never leaves the
 * browser in plaintext — localStorage holds the working copy and a second
 * copy is escrowed on the profile, encrypted with a key derived from the
 * user's login password, so a brand-new device can recover the same key pair
 * and keep decrypting history. Each conversation has a random AES-GCM
 * conversation key which is wrapped (encrypted) for every member with the
 * pairwise ECDH key, stored in `conversation_keys`. Message bodies are stored
 * as "enc:<iv-b64>:<ciphertext-b64>" and can only be decrypted by conversation
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

/** The public JWK matching the stored private key, or null when unavailable. */
function myPublicJwk(userId: string): JsonWebKey | null {
  try {
    const jwk = JSON.parse(localStorage.getItem(privStore(userId))!) as JsonWebKey;
    const pub: JsonWebKey = { kty: jwk.kty!, crv: jwk.crv!, x: jwk.x!, y: jwk.y!, ext: true };
    return pub;
  } catch {
    return null;
  }
}

// ---- Password escrow -------------------------------------------------------
// The private JWK is stored on the profile encrypted under a PBKDF2 key
// derived from the login password. A new device recovers the SAME key pair
// at sign-in instead of generating a fresh one, so all existing wraps and
// history stay readable. Losing the password loses the escrow — the same
// trade-off as any password-protected backup.

const PBKDF2_ITERATIONS = 150_000;

async function passwordKEK(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await subtle().importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  return subtle().deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypts the local private key with the login password and stores it on the profile. */
export async function escrowPrivateKey(userId: string, password: string): Promise<boolean> {
  try {
    const jwk = localStorage.getItem(privStore(userId));
    if (!jwk || !password) return false;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const kek = await passwordKEK(password, salt);
    const ct = await subtle().encrypt({ name: "AES-GCM", iv }, kek, new TextEncoder().encode(jwk));
    const payload = JSON.stringify({ v: 1, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) });
    const { error } = await supabase
      .from("profiles")
      .update({ encrypted_private_key: payload })
      .eq("id", userId);
    return !error;
  } catch {
    return false;
  }
}

function hasEscrowColumn(data: { encrypted_private_key?: unknown } | null): boolean {
  return typeof data?.encrypted_private_key === "string" && data.encrypted_private_key.length > 0;
}

async function fetchEscrow(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("encrypted_private_key")
    .eq("id", userId)
    .maybeSingle();
  return hasEscrowColumn(data as { encrypted_private_key?: unknown } | null)
    ? ((data as { encrypted_private_key: string }).encrypted_private_key)
    : null;
}

/**
 * Recovers the escrowed private key with the login password. Only runs while
 * there is no local key yet (a device that already holds a key keeps it).
 * Returns true when the local store now holds a usable private key.
 */
export async function recoverPrivateKeyFromEscrow(userId: string, password: string): Promise<boolean> {
  try {
    if (localStorage.getItem(privStore(userId)) || !password) return false;
    const raw = await fetchEscrow(userId);
    if (!raw) return false;
    const payload = JSON.parse(raw) as { salt: string; iv: string; ct: string };
    const kek = await passwordKEK(password, fromB64(payload.salt));
    const plain = await subtle().decrypt(
      { name: "AES-GCM", iv: fromB64(payload.iv) },
      kek,
      fromB64(payload.ct),
    );
    const jwk = JSON.parse(new TextDecoder().decode(plain)) as JsonWebKey;
    if (!jwk.d || !jwk.x || !jwk.y) return false;
    localStorage.setItem(privStore(userId), JSON.stringify(jwk));
    // Drop memoized key promises so every path picks up the recovered key.
    ensureMemo.delete(userId);
    privCache.delete(userId);
    pairCache.clear();
    return true;
  } catch {
    return false;
  }
}

const pairCache = new Map<string, Promise<CryptoKey>>();
async function pairKey(userId: string, peerJwk: JsonWebKey): Promise<CryptoKey> {
  const cacheKey = `${userId}:${peerJwk.x}:${peerJwk.y}`;
  let p = pairCache.get(cacheKey);
  if (!p) {
    const pub = await subtle().importKey("jwk", peerJwk, ECDH, false, []);
    p = subtle().deriveKey({ name: "ECDH", public: pub }, await myPrivateKey(userId), { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    pairCache.set(cacheKey, p);
  }
  return p;
}

const convKeyCache = new Map<string, Promise<CryptoKey | null>>();

// ---- Per-device keyring -----------------------------------------------------
// Every conversation key this device has ever successfully derived is kept
// (wrapped nowhere — AES raw keys in localStorage, per conversation). Old
// messages stay readable on this device even after the live key rotates or a
// peer re-wraps history, instead of degrading to "(encrypted message)".
const KEYRING_CAP = 80;
const keyringStore = (conversationId: string) => `sa-e2ee-ring-${conversationId}`;

function loadKeyring(conversationId: string): string[] {
  try {
    const raw = localStorage.getItem(keyringStore(conversationId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

function rememberKey(conversationId: string, key: CryptoKey): void {
  void subtle()
    .exportKey("raw", key)
    .then((buf) => {
      const raw = toB64(buf);
      const ring = loadKeyring(conversationId).filter((k) => k !== raw);
      ring.push(raw);
      while (ring.length > KEYRING_CAP) ring.shift();
      localStorage.setItem(keyringStore(conversationId), JSON.stringify(ring));
    })
    .catch(() => undefined);
}

/** Builds AES keys from the device keyring, newest first. */
async function keyringKeys(conversationId: string): Promise<CryptoKey[]> {
  const out: CryptoKey[] = [];
  for (const raw of loadKeyring(conversationId).reverse()) {
    try {
      out.push(await subtle().importKey("raw", fromB64(raw), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]));
    } catch {
      // skip corrupt ring entries
    }
  }
  return out;
}

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
  const map = new Map<string, JsonWebKey | null>();
  for (const row of (data ?? []) as { user_id: string; profiles: { public_key: string | null } | null }[]) {
    const raw = row.profiles?.public_key ?? null;
    map.set(row.user_id, raw ? (JSON.parse(raw) as JsonWebKey) : null);
  }
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
      return null; // not a member of this conversation
    }
    const { data: conv } = await supabase
      .from("conversations")
      .select("created_by")
      .eq("id", conversationId)
      .maybeSingle();
    const creatorId = (conv as { created_by: string | null } | null)?.created_by ?? meId;

    const fetchRows = async () =>
      (
        await supabase
          .from("conversation_keys")
          .select("wrapped_by, wrapped_key, wrapper_public_key, created_at")
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
      // Newest wrap first: after a key rotation everyone converges on the latest key.
      for (const row of (rows ?? []) as { wrapped_by: string; wrapped_key: string; wrapper_public_key: string | null }[]) {
        // The wrap was created with the wrapper's key pair AT WRAP TIME —
        // stored on the row, because the wrapper may have since signed in on
        // a new device and replaced their profile public key.
        const peer = row.wrapper_public_key
          ? (JSON.parse(row.wrapper_public_key) as JsonWebKey)
          : members.get(row.wrapped_by);
        if (peer) {
          const key = await unwrapKey(meId, peer, row.wrapped_key);
          if (key) {
            rememberKey(conversationId, key);
            return key;
          }
        } else {
        }
      }
    }
    // No row could be unwrapped (e.g. the member's browser keys changed):
    // rotate — create a fresh conversation key and re-wrap it for everyone.
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const key = await subtle().importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
    const myPub = myPublicJwk(meId);
    const inserts: { conversation_id: string; user_id: string; wrapped_by: string; wrapped_key: string; wrapper_public_key: string | null }[] = [];
    for (const [uid, peer] of members) {
      if (!peer) continue;
      try {
        const pk = await pairKey(meId, peer);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = await subtle().encrypt({ name: "AES-GCM", iv }, pk, raw);
        inserts.push({ conversation_id: conversationId, user_id: uid, wrapped_by: meId, wrapped_key: pack(iv, ct), wrapper_public_key: myPub ? JSON.stringify(myPub) : null });
      } catch {
        // member has no usable key yet
      }
    }
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
        convKeyCache.delete(conversationId);
        return null;
      }
      broadcastRotation(conversationId);
      rememberKey(conversationId, key);
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
  if (retryKey) {
    try {
      const plain = await subtle().decrypt({ name: "AES-GCM", iv: packed.iv }, retryKey, packed.data);
      return new TextDecoder().decode(plain);
    } catch {
      // fall through to the device keyring below
    }
  }
  // Every conversation key this device has ever derived, plus every key
  // generation wrapped for me in the database (members may have rotated
  // independently, so the sender's key need not be the newest wrap).
  const candidates = [...(await keyringKeys(conversationId)), ...(await allWrappedKeys(conversationId, meId))];
  for (const ringKey of candidates) {
    try {
      return new TextDecoder().decode(await subtle().decrypt({ name: "AES-GCM", iv: packed.iv }, ringKey, packed.data));
    } catch {
      // try the next key
    }
  }
  allWrappedCache.delete(conversationId);
  convKeyCache.delete(conversationId); // re-derive on the next attempt
  return null;
}

const allWrappedCache = new Map<string, Promise<CryptoKey[]>>();
function allWrappedKeys(conversationId: string, meId: string): Promise<CryptoKey[]> {
  let p = allWrappedCache.get(conversationId);
  if (p) return p;
  p = (async () => {
    await ensureMyKeysOnce(meId);
    const members = await memberPublicKeys(conversationId);
    const { data } = await supabase
      .from("conversation_keys")
      .select("wrapped_by, wrapped_key, wrapper_public_key")
      .eq("conversation_id", conversationId)
      .eq("user_id", meId)
      .order("created_at", { ascending: false });
    const out: CryptoKey[] = [];
    for (const row of (data ?? []) as { wrapped_by: string; wrapped_key: string; wrapper_public_key: string | null }[]) {
      const peers: JsonWebKey[] = [];
      if (row.wrapper_public_key) peers.push(JSON.parse(row.wrapper_public_key) as JsonWebKey);
      const cur = members.get(row.wrapped_by);
      if (cur) peers.push(cur);
      for (const peer of peers) {
        const k = await unwrapKey(meId, peer, row.wrapped_key);
        if (k) {
          out.push(k);
          break;
        }
      }
    }
    return out;
  })().catch(() => [] as CryptoKey[]);
  allWrappedCache.set(conversationId, p);
  return p;
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
      .select("wrapped_by, wrapped_key, wrapper_public_key")
      .eq("conversation_id", conversationId)
      .eq("user_id", meId);
    // Older generations only. The device keyring counts too — a key this
    // device derived once can always migrate history it can still decrypt.
    const candidates = new Map<string, CryptoKey>();
    const ringKeys = await keyringKeys(conversationId);
    const ringRaws = new Set<string>();
    for (const k of ringKeys) {
      const raw = toB64(await subtle().exportKey("raw", k));
      if (raw !== currentRaw) {
        candidates.set(raw, k);
        ringRaws.add(raw);
      }
    }
    for (const row of (keyRows ?? []) as { wrapped_by: string; wrapped_key: string; wrapper_public_key: string | null }[]) {
      // Prefer the wrapper's at-wrap-time public key stored on the row; the
      // wrapper may have since rotated their browser key pair.
      const peer = row.wrapper_public_key
        ? (JSON.parse(row.wrapper_public_key) as JsonWebKey)
        : members.get(row.wrapped_by);
      if (!peer) continue;
      const k = await unwrapKey(meId, peer, row.wrapped_key);
      if (!k) continue;
      const raw = toB64(await subtle().exportKey("raw", k));
      if (raw !== currentRaw && !ringRaws.has(raw)) candidates.set(raw, k);
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
    return migrated;
  } catch {
    return 0;
  }
}

/**
 * One-stop key setup for a fresh sign-in: recover the escrowed key pair when
 * one exists, otherwise generate keys and create the escrow. Repairs a stale
 * escrow (e.g. after a password change) on the next sign-in.
 */
export async function setupKeysAfterSignIn(userId: string, password: string): Promise<void> {
  try {
    if (await recoverPrivateKeyFromEscrow(userId, password)) return;
    await ensureMyKeys(userId);
    await escrowPrivateKey(userId, password);
  } catch {
    // E2EE setup is best-effort; chat falls back to the no-key path.
  }
}
