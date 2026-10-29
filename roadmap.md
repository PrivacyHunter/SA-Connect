# Roadmap

## Completed
- [x] E2EE key convergence: creator-owns-key + queued rotation broadcast (src/lib/e2ee.ts)
- [x] Scenario A: live chat + same-context reload decryption (two accounts)
- [x] Wrap races fixed: in-flight key dedup, insert-not-upsert rotations, wrapper public key stored at wrap time
- [x] **Scenario B (brand-new device) VERIFIED 2026-10-28** — three fresh browsers in sequence:
  ali sends 3 probes → sara decrypts all 3 and replies → ali on a 2nd fresh device decrypts the reply.
  Fix: private key escrow encrypted with the login password (profiles.encrypted_private_key,
  PBKDF2 150k + AES-GCM); recovered at sign-in via setupKeysAfterSignIn (src/routes/auth.tsx).
  Falls back to the old rotate path for OAuth (no password) sign-ins.
- [x] **Divergent-device fix VERIFIED 2026-10-29** (16/16 two-account cases): a device whose key differs from the
  account key, or a restored session with no key, is locked and unlocks with the password instead of overwriting
  the account key; any member re-shares the key and re-encrypts readable history.
- [x] `[e2ee]` debug console logs removed from src/lib/e2ee.ts after verification
- [x] Signup 50 credits, live notification bell, one-view, premium save controls, deleted-note
- [x] Online/last seen, typing + recording animations, clear chat, block/report/report-and-block, premium self-unblock
- [x] Developer panel access, discover_members, referral code card
- [x] Last-seen timestamps, sent/delivered/seen ticks, delete-for-me / delete-for-everyone (premium note), chat wallpaper
- [x] Emoji/sticker/GIF picker (chat-picker.tsx): emoji insert, built-in GIF pack, gallery→sticker creation, favorites, recent stickers, "Save sticker" message menu — verified in preview 2026-10-29
- [x] Premium submission now REQUIRES the transaction (TRX) ID + screenshot — verified submit stays disabled without them
- [x] Chat list preview fixed: DB trigger keeps last_message_at/body in sync (previously never written); sticker/GIF/photo/voice previews show; delete-for-everyone updates the preview
- [x] Privacy fix: conversations were readable by every signed-in account (chat list leaked other people's DMs) — restrictive members-only read policy added + chat list filtered by membership
- [x] Admin Reports tab (/panel) with resolve/dismiss/ban; blocked-users list on profile
- Test credentials: ali.test@saconnect-test.com / sara.test@saconnect-test.com (password set by test harness 2026-10-28; escrow seeded for both)

## Open (optional / nice-to-have)
- [ ] OAuth (Google) sign-ins cannot recover the escrow (no password): history on a new device relies on the old rotate path until the password user re-wraps. Possible follow-up: creator-side re-wrap for members whose profile key changed.
- [ ] TURN relay for WebRTC calls behind strict NAT (currently STUN only)
- [ ] Automated voice-note send selector in the E2E script
- [ ] Web push notifications (optional)
