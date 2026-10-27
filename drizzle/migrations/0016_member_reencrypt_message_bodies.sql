-- E2EE history migration: when a member rotates the conversation key (new
-- device/browser), another member who can still decrypt the history
-- (typically the creator) re-encrypts message bodies with the new key.
-- Members need UPDATE on messages, restricted to members, and the new body
-- must stay E2EE ciphertext.
drop policy if exists "sender updates own messages" on public.messages;
create policy "members update message bodies"
  on public.messages
  for update to authenticated
  using (is_conversation_member(conversation_id, auth.uid()))
  with check (is_conversation_member(conversation_id, auth.uid()) and body like 'enc:%');