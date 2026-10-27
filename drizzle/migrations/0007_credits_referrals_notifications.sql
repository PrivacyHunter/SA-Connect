-- ============ Credits, referrals, notifications, one-view enforcement ============

CREATE TABLE public.credit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount integer NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.credit_events TO authenticated;
GRANT ALL ON public.credit_events TO service_role;
ALTER TABLE public.credit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own credits" ON public.credit_events FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "insert own credits" ON public.credit_events FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
-- one-time tasks can only ever be awarded once per user
CREATE UNIQUE INDEX credit_events_once_idx ON public.credit_events (user_id, reason)
  WHERE reason IN ('signup','first_post','first_reel','first_video','first_listing','first_pic');

CREATE TABLE public.credit_progress (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  messages_sent integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.credit_progress TO authenticated;
GRANT ALL ON public.credit_progress TO service_role;
ALTER TABLE public.credit_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own progress" ON public.credit_progress FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.referrals (
  referrer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referred_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.referrals TO authenticated;
GRANT ALL ON public.referrals TO service_role;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own referrals" ON public.referrals FOR SELECT TO authenticated
  USING (referrer_id = auth.uid() OR referred_id = auth.uid());

-- Unique referral code on every profile
ALTER TABLE public.profiles ADD COLUMN referral_code text;
CREATE UNIQUE INDEX profiles_referral_code_idx ON public.profiles(referral_code) WHERE referral_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assign_referral_code()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.referral_code IS NULL OR NEW.referral_code = '' THEN
    NEW.referral_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER profiles_assign_referral_code BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.assign_referral_code();

-- Backfill codes for existing profiles (part of the additive column change)
UPDATE public.profiles
  SET referral_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  WHERE referral_code IS NULL;

-- Public check so the signup form can show who a referral code belongs to
CREATE OR REPLACE FUNCTION public.referral_preview(p_code text)
RETURNS TABLE (display_name text, username text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.display_name, p.username FROM public.profiles p
  WHERE p.referral_code = upper(btrim(p_code))
  LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.referral_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_preview(text) TO anon, authenticated;

-- ============ Credit award triggers ============

CREATE OR REPLACE FUNCTION public.award_message_credits()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cnt integer;
BEGIN
  INSERT INTO public.credit_progress (user_id, messages_sent) VALUES (NEW.sender_id, 1)
    ON CONFLICT (user_id) DO UPDATE
      SET messages_sent = public.credit_progress.messages_sent + 1, updated_at = now()
    RETURNING messages_sent INTO cnt;
  IF cnt % 10 = 0 THEN
    INSERT INTO public.credit_events (user_id, amount, reason) VALUES (NEW.sender_id, 10, 'messages_10');
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER messages_award_credits AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.award_message_credits();

CREATE OR REPLACE FUNCTION public.award_content_credits()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE owner uuid; cnt bigint; reason text; amount integer; col text;
BEGIN
  IF TG_TABLE_NAME = 'posts' THEN owner := NEW.author_id; reason := 'first_post'; amount := 20; col := 'author_id';
  ELSIF TG_TABLE_NAME = 'reels' THEN owner := NEW.author_id; reason := 'first_reel'; amount := 20; col := 'author_id';
  ELSIF TG_TABLE_NAME = 'videos' THEN owner := NEW.channel_id; reason := 'first_video'; amount := 20; col := 'channel_id';
  ELSIF TG_TABLE_NAME = 'marketplace_listings' THEN owner := NEW.seller_id; reason := 'first_listing'; amount := 20; col := 'seller_id';
  ELSE RETURN NULL;
  END IF;
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', TG_TABLE_NAME, col) INTO cnt USING owner;
  IF cnt = 1 THEN
    INSERT INTO public.credit_events (user_id, amount, reason) VALUES (owner, amount, reason) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER posts_award_credits AFTER INSERT ON public.posts FOR EACH ROW EXECUTE FUNCTION public.award_content_credits();
CREATE TRIGGER reels_award_credits AFTER INSERT ON public.reels FOR EACH ROW EXECUTE FUNCTION public.award_content_credits();
CREATE TRIGGER videos_award_credits AFTER INSERT ON public.videos FOR EACH ROW EXECUTE FUNCTION public.award_content_credits();
CREATE TRIGGER listings_award_credits AFTER INSERT ON public.marketplace_listings FOR EACH ROW EXECUTE FUNCTION public.award_content_credits();

CREATE OR REPLACE FUNCTION public.award_pic_credit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.avatar_url IS NOT NULL AND (OLD.avatar_url IS NULL OR OLD.avatar_url = '') THEN
    INSERT INTO public.credit_events (user_id, amount, reason) VALUES (NEW.id, 10, 'first_pic') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER profiles_pic_credit AFTER UPDATE OF avatar_url ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.award_pic_credit();

CREATE OR REPLACE FUNCTION public.award_signup_credits()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE code text; ref_id uuid;
BEGIN
  INSERT INTO public.credit_events (user_id, amount, reason) VALUES (NEW.id, 50, 'signup') ON CONFLICT DO NOTHING;
  IF NEW.raw_user_meta_data ? 'referral_code' THEN
    code := upper(btrim(NEW.raw_user_meta_data->>'referral_code'));
    IF code <> '' THEN
      SELECT id INTO ref_id FROM public.profiles WHERE referral_code = code AND id <> NEW.id LIMIT 1;
      IF ref_id IS NOT NULL THEN
        INSERT INTO public.referrals (referrer_id, referred_id) VALUES (ref_id, NEW.id) ON CONFLICT (referred_id) DO NOTHING;
        INSERT INTO public.credit_events (user_id, amount, reason) VALUES (ref_id, 10, 'referral:' || NEW.id::text);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW; -- signup must never fail because of credits
END $$;
CREATE TRIGGER z_award_signup_credits AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.award_signup_credits();

-- ============ User notifications ============

CREATE TABLE public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'info',
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.user_notifications TO authenticated;
GRANT ALL ON public.user_notifications TO service_role;
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own notifications" ON public.user_notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "mark own notifications read" ON public.user_notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ One-view: server-side enforcement ============
-- A viewed one-view message disappears for everyone except its sender and
-- premium members (premium keeps every message until they delete it).

DROP POLICY "read member messages" ON public.messages;
CREATE POLICY "read member messages" ON public.messages FOR SELECT TO authenticated
USING (
  is_conversation_member(conversation_id, auth.uid())
  AND (
    sender_id = auth.uid()
    OR NOT one_view
    OR EXISTS (SELECT 1 FROM public.premium_access p WHERE p.user_id = auth.uid() AND p.premium_until > now())
    OR NOT EXISTS (
      SELECT 1 FROM public.message_views v
      WHERE v.message_id = messages.id AND v.user_id = auth.uid()
    )
  )
);