CREATE OR REPLACE FUNCTION public.can_view_profile(p uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    p = auth.uid()
    OR public.is_staff(auth.uid())
    OR EXISTS (SELECT 1 FROM public.follows f WHERE (f.follower_id = auth.uid() AND f.following_id = p) OR (f.following_id = auth.uid() AND f.follower_id = p))
    OR EXISTS (SELECT 1 FROM public.conversation_members a JOIN public.conversation_members b ON a.conversation_id = b.conversation_id WHERE a.user_id = auth.uid() AND b.user_id = p)
    OR EXISTS (SELECT 1 FROM public.contacts c WHERE (c.owner_id = auth.uid() AND c.contact_id = p) OR (c.contact_id = auth.uid() AND c.owner_id = p))
    OR EXISTS (SELECT 1 FROM public.posts WHERE author_id = p)
    OR EXISTS (SELECT 1 FROM public.reels WHERE author_id = p)
    OR EXISTS (SELECT 1 FROM public.videos WHERE channel_id = p)
    OR EXISTS (SELECT 1 FROM public.stories WHERE author_id = p AND expires_at > now())
    OR EXISTS (SELECT 1 FROM public.comments WHERE author_id = p)
    OR EXISTS (SELECT 1 FROM public.reel_comments WHERE author_id = p)
    OR EXISTS (SELECT 1 FROM public.marketplace_listings WHERE seller_id = p)
  ) $function$;