CREATE OR REPLACE FUNCTION public.can_read_author_thread(p_author uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (p_author = auth.uid() OR public.is_staff(auth.uid())
    OR EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = auth.uid() AND f.following_id = p_author)) $$;
REVOKE EXECUTE ON FUNCTION public.can_read_author_thread(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.can_read_author_thread(uuid) TO authenticated;

DROP POLICY IF EXISTS "read comments" ON public.comments;
CREATE POLICY "read comments in followed threads" ON public.comments FOR SELECT TO authenticated USING (
  auth.uid() = author_id OR EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id AND public.can_read_author_thread(p.author_id)));

DROP POLICY IF EXISTS "read reel comments" ON public.reel_comments;
CREATE POLICY "read reel comments in followed threads" ON public.reel_comments FOR SELECT TO authenticated USING (
  auth.uid() = author_id OR EXISTS (SELECT 1 FROM public.reels r WHERE r.id = reel_id AND public.can_read_author_thread(r.author_id)));