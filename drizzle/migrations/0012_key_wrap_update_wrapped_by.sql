DROP POLICY "author updates own key wrap" ON public.conversation_keys;
CREATE POLICY "author updates own key wrap" ON public.conversation_keys FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR wrapped_by = auth.uid())
  WITH CHECK (user_id = auth.uid() OR wrapped_by = auth.uid());
DELETE FROM public.messages WHERE body = 'plain realtime probe';
DELETE FROM public.messages WHERE body = 'hello';