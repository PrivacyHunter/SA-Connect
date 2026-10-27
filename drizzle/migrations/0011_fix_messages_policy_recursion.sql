CREATE OR REPLACE FUNCTION public.is_message_author(p_message uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.messages WHERE id = p_message AND sender_id = p_user)
$$;
REVOKE ALL ON FUNCTION public.is_message_author(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_message_author(uuid, uuid) TO authenticated;

DROP POLICY "own or author reads views" ON public.message_views;
CREATE POLICY "own or author reads views" ON public.message_views FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_message_author(message_views.message_id, auth.uid()));

CREATE POLICY "author updates own key wrap" ON public.conversation_keys FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());