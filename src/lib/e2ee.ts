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

/** Ensures the signed-in user has an E2EE key pair and uploads the public key to their profile. */
export async function ensureMyKeys(userId: string): Promise<void> {
  try {
    let stored = localStorage.getItem(privStore(userId));
    if (!stored) {
      const pair = await subtle().generateKey(ECDH, true, ["deriveKey"]);
      const privJwk = await subtle().exportKey("jwk", pair.privateKey);
      stored = JSON.stringify(privJwk);
      localStorage.setItem(privStore(userId), stored);
    }
    const jwk = JSON.parse(stored) as JsonWebKey;
    const publicJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true };
    const pubJwk = JSON.stringify(publicJwk);
    const { data } = await supabase.from("profiles").select("public_key").eq("id", userId).maybeSingle();
    if (data && data.public_key !== pubJwk) {
      await supabase.from("profiles").update({ public_key: pubJwk }).eq("id", userId);
    }
  } catch {
    // E2EE unavailable; messages fall back to plaintext transport
  }
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
  void keysyncChannel(conversationId).send({ type: "broadcast", event: "rotated" });
}

async function memberPublicKeys(conversationId: string): Promise<Map<string, JsonWebKey | null>> {
  const { data } = await supabase
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
  } catch {
    return null;
  }
}

/** Returns the conversation AES key, creating and distributing one when missing. */
export async function getConversationKey(conversationId: string, meId: string): Promise<CryptoKey | null> {
  const cached = convKeyCache.get(conversationId);
  if (cached) return cached;
  const promise = (async () => {
    const members = await memberPublicKeys(conversationId);
    if (!members.has(meId)) return null; // not a member of this conversation
    const { data: rows } = await supabase
      .from("conversation_keys")
      .select("wrapped_by, wrapped_key, created_at")
      .eq("conversation_id", conversationId)
      .eq("user_id", meId)
      .order("created_at", { ascending: false });
    // Newest wrap first: after a key rotation everyone converges on the latest key.
    for (const row of (rows ?? []) as { wrapped_by: string; wrapped_key: string }[]) {
      const peer = members.get(row.wrapped_by);
      if (peer) {
        const key = await unwrapKey(meId, peer, row.wrapped_key);
        if (key) return key;
      }
    }
    // No row could be unwrapped (e.g. the member's browser keys changed):
    // rotate — create a fresh conversation key and re-wrap it for everyone.
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
    if (inserts.length) {
      await supabase
        .from("conversation_keys")
        .upsert(inserts, { onConflict: "conversation_id,user_id,wrapped_by" });
      broadcastRotation(conversationId);
    }
    return key;
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
