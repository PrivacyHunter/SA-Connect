<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Share the uploaded brand asset through the Brand component and semantic global theme tokens so identity remains consistent.
- The public home and auth pages share AuthPage; keep account entry behavior in one place to prevent divergent login flows.
- Privileged panel operations use authenticated server functions that validate caller and target roles before dynamically loading the admin client, so UI controls never authorize access.
- Contact discovery matches only verified, opted-in emails; do not store uploaded address books or reveal non-opted-in identities.
- Account restrictions are enforced through restrictive database and storage policies; frozen accounts are read-only and deactivated accounts retain recoverable records.
- Marketplace listings use authenticated owner-scoped writes and the existing private media bucket; all rows come from users.
- Profile visibility goes through can_view_profile (self, staff, connections, content creators); chat discovery of other members goes through the discover_members RPC (limited, excludes banned/blocked), because the owner wants new members startable in chat.
- Levels/badges are derived from activity counts (profile_stats + src/lib/levels.ts), not stored, so they cannot be edited by users.
- File downloads go through can_download_from (owner, followers, chat partners, staff); site-wide marquee and social links live in the single-row site_settings table, edited only via developer/owner server functions.
- Staff reading user chats goes through moderation server functions restricted to developer/owner and every read is written to admin_audit.
- Phone verification uses an app-owned OTP (hashed code, 10 min expiry, 5 attempts, 60s resend) sent via the Twilio connector, not Supabase phone auth.
- Chat E2EE: a device only generates or uploads a public key when the account has no password escrow; otherwise a mismatched device is "locked" and must unlock with the password. Why: devices overwriting the profile key locked each other out of every chat.
