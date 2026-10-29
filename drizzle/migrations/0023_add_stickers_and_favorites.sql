CREATE TABLE public.stickers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  media_path text not null unique,
  created_at timestamptz not null default now()
);
GRANT SELECT, INSERT, DELETE ON public.stickers TO authenticated;
GRANT ALL ON public.stickers TO service_role;
ALTER TABLE public.stickers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view the sticker library" ON public.stickers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can add their own stickers" ON public.stickers FOR INSERT TO authenticated WITH CHECK (owner_id = (select auth.uid()));
CREATE POLICY "Users can remove their own stickers" ON public.stickers FOR DELETE TO authenticated USING (owner_id = (select auth.uid()));

CREATE TABLE public.sticker_favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  media_path text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, media_path)
);
GRANT SELECT, INSERT, DELETE ON public.sticker_favorites TO authenticated;
GRANT ALL ON public.sticker_favorites TO service_role;
ALTER TABLE public.sticker_favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read their own sticker favorites" ON public.sticker_favorites FOR SELECT TO authenticated USING (user_id = (select auth.uid()));
CREATE POLICY "Users add their own sticker favorites" ON public.sticker_favorites FOR INSERT TO authenticated WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY "Users remove their own sticker favorites" ON public.sticker_favorites FOR DELETE TO authenticated USING (user_id = (select auth.uid()));