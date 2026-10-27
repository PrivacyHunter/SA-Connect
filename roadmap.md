## Completed
- [x] E2EE key convergence: creator-owns-key + queued rotation broadcast (src/lib/e2ee.ts)
- [x] Live bell badge test passed with real-time notification insert
- [x] 50 signup credits, premium save controls, deleted-note (when keys converge) verified

## Open (E2EE reload desync — top priority)
- [ ] Sara's page after reload fails to unwrap (user_id=her, wrapped_by=ali) row and decrypts 0/4 messages (enc 4), while live decrypt worked before reload. DB showed exactly ONE key generation (ali=creator rotated once at 08:18:04) — so unwrap should succeed on reload. Investigate: does reload run a DIFFERENT code path (e.g. decryptStoredText cache/attempt loop, memberPublicKeys result, or profile public_key change)? Instrument check_chat.py reload1 point with sara's localStorage e2ee key fingerprint + profiles.public_key compare.
- [ ] Voice note E2E: "Record voice note" click not found on ali's page after video flow; DBG mic dump patch did NOT apply (replace() no-op, no "DBG mic" output) — re-apply and capture button list/screenshot dbg_mic.png.
- [ ] Re-run /tmp/browser/check_chat.py end-to-end until full PASS; clean conversation + insert 2nd user_notifications row mid-run each time (script does NOT clean/insert itself).
- [ ] Premium race hypothesis (queryKey ["messages", id, premium]) unverified — only touch if reload failure isn't pure E2EE.
