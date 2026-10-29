-- Conversations must only be readable by their members (or the creator).
-- The generic account_read_guard policy allowed every signed-in account to
-- read every conversation row, so the chat list leaked other people's chats.
CREATE POLICY "conversation members only read (restrictive)"
ON public.conversations
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  created_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.conversation_members cm
    WHERE cm.conversation_id = conversations.id AND cm.user_id = auth.uid()
  )
);