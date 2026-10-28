INSERT INTO public.user_roles (user_id, role) VALUES ('e2a683cd-7757-485d-b360-3ea170da6204', 'developer') ON CONFLICT (user_id) DO UPDATE SET role = 'developer';

CREATE OR REPLACE FUNCTION public.discover_members(p_search text DEFAULT '')
RETURNS SETOF public.profiles
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT p.* FROM public.profiles p
  WHERE auth.uid() IS NOT NULL AND public.account_can_read() AND p.id <> auth.uid()
    AND NOT EXISTS (SELECT 1 FROM public.account_controls c WHERE c.user_id = p.id AND c.status IN ('banned','deleted','suspended'))
    AND NOT EXISTS (SELECT 1 FROM public.user_blocks b WHERE (b.blocker_id = auth.uid() AND b.blocked_id = p.id) OR (b.blocked_id = auth.uid() AND b.blocker_id = p.id))
    AND (coalesce(btrim(p_search),'') = '' OR p.username ILIKE '%' || btrim(p_search) || '%' OR p.display_name ILIKE '%' || btrim(p_search) || '%')
  ORDER BY p.last_seen_at DESC NULLS LAST, p.created_at DESC
  LIMIT 30
$$;
REVOKE ALL ON FUNCTION public.discover_members(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.discover_members(text) TO authenticated;