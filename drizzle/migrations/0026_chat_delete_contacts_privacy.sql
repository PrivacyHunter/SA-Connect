-- 1) Per-user chat delete: hide the conversation from my list until a new message arrives
ALTER TABLE public.conversation_members ADD COLUMN deleted_at timestamptz;
COMMENT ON COLUMN public.conversation_members.deleted_at IS 'Per-user chat delete: set when this member deletes the chat; cleared when a new message arrives.';

CREATE OR REPLACE FUNCTION public.messages_unhide_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.conversation_members
  SET deleted_at = NULL
  WHERE conversation_id = NEW.conversation_id AND deleted_at IS NOT NULL;
  RETURN NULL;
END $function$;

CREATE TRIGGER messages_unhide_conversation
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION messages_unhide_conversation();

-- 2) Persistent contact list: matches from contact discovery are saved here
CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, contact_id),
  CHECK (owner_id <> contact_id)
);
GRANT SELECT, INSERT, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY contacts_owner_select ON public.contacts FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY contacts_owner_insert ON public.contacts FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY contacts_owner_delete ON public.contacts FOR DELETE TO authenticated USING (owner_id = auth.uid());

-- 3) Contact matching now also saves matches as the caller's contacts
CREATE OR REPLACE FUNCTION public.match_contacts(emails text[])
RETURNS TABLE(id uuid, display_name text, username text, matched_email text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.contacts (owner_id, contact_id)
  SELECT auth.uid(), p.id
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  JOIN public.contact_discovery d ON d.user_id = p.id AND d.enabled
  WHERE auth.uid() IS NOT NULL
    AND u.email_confirmed_at IS NOT NULL
    AND lower(u.email) = ANY(emails[1:200])
    AND p.id <> auth.uid()
    AND NOT EXISTS (SELECT 1 FROM public.account_controls a WHERE a.user_id = p.id AND a.status IN ('banned','deleted','suspended'))
  ON CONFLICT (owner_id, contact_id) DO NOTHING;

  RETURN QUERY
  SELECT p.id, p.display_name, p.username, lower(u.email)
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  JOIN public.contact_discovery d ON d.user_id = p.id AND d.enabled
  WHERE auth.uid() IS NOT NULL
    AND public.account_can_read()
    AND u.email_confirmed_at IS NOT NULL
    AND lower(u.email) = ANY(emails[1:200])
    AND NOT EXISTS (SELECT 1 FROM public.account_controls a WHERE a.user_id = p.id AND a.status IN ('banned','deleted','suspended'));
END $function$;

-- 4) Privacy: chat discovery shows ONLY my contacts, people I already share a
-- conversation with, and members who joined through my referral link
CREATE OR REPLACE FUNCTION public.discover_members(p_search text DEFAULT ''::text)
RETURNS SETOF profiles
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.* FROM public.profiles p
  WHERE auth.uid() IS NOT NULL AND public.account_can_read() AND p.id <> auth.uid()
    AND NOT EXISTS (SELECT 1 FROM public.account_controls c WHERE c.user_id = p.id AND c.status IN ('banned','deleted','suspended'))
    AND NOT EXISTS (SELECT 1 FROM public.user_blocks b WHERE (b.blocker_id = auth.uid() AND b.blocked_id = p.id) OR (b.blocked_id = auth.uid() AND b.blocker_id = p.id))
    AND (
      EXISTS (SELECT 1 FROM public.contacts c WHERE c.owner_id = auth.uid() AND c.contact_id = p.id)
      OR EXISTS (SELECT 1 FROM public.conversation_members a JOIN public.conversation_members b ON a.conversation_id = b.conversation_id WHERE a.user_id = auth.uid() AND b.user_id = p.id)
      OR EXISTS (SELECT 1 FROM public.referrals r WHERE (r.referrer_id = auth.uid() AND r.referred_id = p.id) OR (r.referred_id = auth.uid() AND r.referrer_id = p.id))
    )
    AND (coalesce(btrim(p_search),'') = '' OR p.username ILIKE '%' || btrim(p_search) || '%' OR p.display_name ILIKE '%' || btrim(p_search) || '%')
  ORDER BY p.last_seen_at DESC NULLS LAST, p.created_at DESC
  LIMIT 30
$function$;