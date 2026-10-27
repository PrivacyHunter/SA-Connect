DROP POLICY "members read conversations" ON public.conversations;
CREATE POLICY "members read conversations" ON public.conversations FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.conversation_members cm WHERE cm.conversation_id = conversations.id AND cm.user_id = auth.uid())
  );