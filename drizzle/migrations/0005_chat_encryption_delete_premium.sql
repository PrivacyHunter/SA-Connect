-- Chat performance indexes
CREATE INDEX IF NOT EXISTS messages_conv_created_idx ON public.messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS conversations_last_msg_idx ON public.conversations (last_message_at DESC NULLS LAST);

ALTER TABLE public.conversation_members ADD COLUMN IF NOT EXISTS muted boolean NOT NULL DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS one_view boolean NOT NULL DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS deleted_for_everyone boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS public_key text;

-- Per-user delete-for-me rows
CREATE TABLE public.message_deletes (
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
GRANT SELECT, INSERT, DELETE ON public.message_deletes TO authenticated;
GRANT ALL ON public.message_deletes TO service_role;
ALTER TABLE public.message_deletes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own message deletes" ON public.message_deletes FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- One-view acknowledgements
CREATE TABLE public.message_views (
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
GRANT SELECT, INSERT ON public.message_views TO authenticated;
GRANT ALL ON public.message_views TO service_role;
ALTER TABLE public.message_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own or author reads views" ON public.message_views FOR SELECT TO authenticated USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_views.message_id AND m.sender_id = auth.uid()));
CREATE POLICY "insert own view" ON public.message_views FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- End-to-end encryption: conversation keys wrapped per member
CREATE TABLE public.conversation_keys (
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  wrapped_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  wrapped_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id, wrapped_by)
);
GRANT SELECT, INSERT ON public.conversation_keys TO authenticated;
GRANT ALL ON public.conversation_keys TO service_role;
ALTER TABLE public.conversation_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read keys" ON public.conversation_keys FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.conversation_members cm WHERE cm.conversation_id = conversation_keys.conversation_id AND cm.user_id = auth.uid()));
CREATE POLICY "members insert keys" ON public.conversation_keys FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.conversation_members cm WHERE cm.conversation_id = conversation_keys.conversation_id AND cm.user_id = auth.uid()));

-- Premium access (service-managed; users cannot self-grant)
CREATE TABLE public.premium_access (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  premium_until timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.premium_access TO authenticated;
GRANT ALL ON public.premium_access TO service_role;
ALTER TABLE public.premium_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY "premium status readable" ON public.premium_access FOR SELECT TO authenticated USING (true);

-- Manual payment submissions
CREATE TABLE public.payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  screenshot_path text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.payment_requests TO authenticated;
GRANT ALL ON public.payment_requests TO service_role;
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own or staff read requests" ON public.payment_requests FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "create own request" ON public.payment_requests FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS payment_info text NOT NULL DEFAULT '';

-- Allow senders to mark their own message deleted-for-everyone and members to mute
CREATE POLICY "sender updates own messages" ON public.messages FOR UPDATE TO authenticated USING (sender_id = auth.uid()) WITH CHECK (sender_id = auth.uid());
CREATE POLICY "member updates own membership" ON public.conversation_members FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());