CREATE OR REPLACE FUNCTION public.can_download_from(p_owner text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    p_owner = auth.uid()::text OR public.is_staff(auth.uid())
    OR EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = auth.uid() AND f.following_id::text = p_owner)
    OR EXISTS (SELECT 1 FROM public.conversation_members a JOIN public.conversation_members b ON a.conversation_id = b.conversation_id WHERE a.user_id = auth.uid() AND b.user_id::text = p_owner)
  ) $$;
REVOKE EXECUTE ON FUNCTION public.can_download_from(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.can_download_from(text) TO authenticated;

DROP POLICY IF EXISTS "authenticated read app files" ON storage.objects;
CREATE POLICY "read files of self, followed, chat partners, staff" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('avatars','media') AND public.can_download_from((storage.foldername(name))[1]));

CREATE TABLE public.site_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  marquee text[] NOT NULL DEFAULT '{}',
  facebook_url text NOT NULL DEFAULT '',
  instagram_url text NOT NULL DEFAULT '',
  youtube_url text NOT NULL DEFAULT '',
  x_url text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.site_settings (id) VALUES (true);
GRANT SELECT ON public.site_settings TO authenticated, anon;
GRANT ALL ON public.site_settings TO service_role;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone reads site settings" ON public.site_settings FOR SELECT TO anon, authenticated USING (id);

CREATE TABLE public.phone_verifications (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  phone text NOT NULL,
  code_hash text,
  expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.phone_verifications TO authenticated;
GRANT ALL ON public.phone_verifications TO service_role;
ALTER TABLE public.phone_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own phone status" ON public.phone_verifications FOR SELECT TO authenticated USING (auth.uid() = user_id);