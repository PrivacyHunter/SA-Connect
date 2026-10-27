CREATE OR REPLACE FUNCTION public.is_staff(p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p) $$;

CREATE OR REPLACE FUNCTION public.can_view_profile(p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    p = auth.uid()
    OR public.is_staff(auth.uid())
    OR EXISTS (SELECT 1 FROM public.follows f WHERE (f.follower_id = auth.uid() AND f.following_id = p) OR (f.following_id = auth.uid() AND f.follower_id = p))
    OR EXISTS (SELECT 1 FROM public.conversation_members a JOIN public.conversation_members b ON a.conversation_id = b.conversation_id WHERE a.user_id = auth.uid() AND b.user_id = p)
    OR EXISTS (SELECT 1 FROM public.posts WHERE author_id = p)
    OR EXISTS (SELECT 1 FROM public.reels WHERE author_id = p)
    OR EXISTS (SELECT 1 FROM public.videos WHERE channel_id = p)
    OR EXISTS (SELECT 1 FROM public.stories WHERE author_id = p AND expires_at > now())
    OR EXISTS (SELECT 1 FROM public.comments WHERE author_id = p)
    OR EXISTS (SELECT 1 FROM public.reel_comments WHERE author_id = p)
    OR EXISTS (SELECT 1 FROM public.marketplace_listings WHERE seller_id = p)
  ) $$;

DROP POLICY IF EXISTS "authenticated can read profiles" ON public.profiles;
CREATE POLICY "read visible profiles" ON public.profiles FOR SELECT TO authenticated USING (public.can_view_profile(id));

DROP POLICY IF EXISTS "read follows" ON public.follows;
CREATE POLICY "read own follows" ON public.follows FOR SELECT TO authenticated USING (auth.uid() = follower_id OR auth.uid() = following_id);

DROP POLICY IF EXISTS "read subscriptions" ON public.subscriptions;
CREATE POLICY "read own subscriptions" ON public.subscriptions FOR SELECT TO authenticated USING (auth.uid() = subscriber_id OR auth.uid() = channel_id);

DROP POLICY IF EXISTS "read bookmarks" ON public.post_bookmarks;
CREATE POLICY "read own bookmarks" ON public.post_bookmarks FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "read video bookmarks" ON public.video_bookmarks;
CREATE POLICY "read own video bookmarks" ON public.video_bookmarks FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "read story views" ON public.story_views;
CREATE POLICY "read own story views" ON public.story_views FOR SELECT TO authenticated USING (auth.uid() = viewer_id OR EXISTS (SELECT 1 FROM public.stories s WHERE s.id = story_id AND s.author_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.find_user_by_username(p_username text) RETURNS SETOF public.profiles LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.* FROM public.profiles p WHERE auth.uid() IS NOT NULL AND lower(p.username) = lower(trim(p_username))
  AND NOT EXISTS (SELECT 1 FROM public.account_controls c WHERE c.user_id = p.id AND c.status IN ('banned','deleted','suspended')) LIMIT 1 $$;

CREATE OR REPLACE FUNCTION public.profile_stats(p uuid) RETURNS TABLE(posts bigint, reels bigint, videos bigint, comments bigint, followers bigint, following bigint, days bigint) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (SELECT count(*) FROM public.posts WHERE author_id = p), (SELECT count(*) FROM public.reels WHERE author_id = p), (SELECT count(*) FROM public.videos WHERE channel_id = p),
   (SELECT count(*) FROM public.comments WHERE author_id = p) + (SELECT count(*) FROM public.reel_comments WHERE author_id = p),
   (SELECT count(*) FROM public.follows WHERE following_id = p), (SELECT count(*) FROM public.follows WHERE follower_id = p),
   (SELECT GREATEST(0, extract(day FROM now() - created_at))::bigint FROM public.profiles WHERE id = p)
  WHERE auth.uid() IS NOT NULL $$;

REVOKE EXECUTE ON FUNCTION public.can_view_profile(uuid), public.is_staff(uuid), public.find_user_by_username(text), public.profile_stats(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.can_view_profile(uuid), public.is_staff(uuid), public.find_user_by_username(text), public.profile_stats(uuid) TO authenticated;