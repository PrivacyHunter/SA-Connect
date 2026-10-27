DROP POLICY "read memberships" ON public.conversation_members;
CREATE POLICY "read memberships" ON public.conversation_members FOR SELECT TO authenticated
  USING (public.is_conversation_member(conversation_id, auth.uid()));