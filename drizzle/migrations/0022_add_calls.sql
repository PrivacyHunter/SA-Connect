-- ============ Calls: history + WebRTC signaling ============

CREATE TABLE public.call_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  caller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  callee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('voice','video')),
  status text NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing','answered','missed','declined','cancelled')),
  duration_seconds integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX call_log_created_idx ON public.call_log (created_at DESC);
CREATE INDEX call_log_caller_idx ON public.call_log (caller_id, created_at DESC);
CREATE INDEX call_log_callee_idx ON public.call_log (callee_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.call_log TO authenticated;
GRANT ALL ON public.call_log TO service_role;
ALTER TABLE public.call_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own call log" ON public.call_log FOR SELECT TO authenticated
USING (caller_id = auth.uid() OR callee_id = auth.uid());
CREATE POLICY "log own outgoing calls" ON public.call_log FOR INSERT TO authenticated
WITH CHECK (
  caller_id = auth.uid()
  AND public.is_conversation_member(conversation_id, auth.uid())
  AND public.is_conversation_member(conversation_id, callee_id)
);
CREATE POLICY "update own call log" ON public.call_log FOR UPDATE TO authenticated
USING (caller_id = auth.uid()) WITH CHECK (caller_id = auth.uid());

-- Short-lived WebRTC signaling rows (offer / answer / ICE / end), delivered
-- through realtime so a call rings anywhere in the app, not only inside the chat.
CREATE TABLE public.call_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  from_user uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  to_user uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('offer','answer','ice','end')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX call_signals_to_idx ON public.call_signals (to_user, created_at);
GRANT SELECT, INSERT, DELETE ON public.call_signals TO authenticated;
GRANT ALL ON public.call_signals TO service_role;
ALTER TABLE public.call_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own call signals" ON public.call_signals FOR SELECT TO authenticated
USING (
  (from_user = auth.uid() OR to_user = auth.uid())
  AND public.is_conversation_member(conversation_id, auth.uid())
);
CREATE POLICY "send call signals" ON public.call_signals FOR INSERT TO authenticated
WITH CHECK (
  from_user = auth.uid()
  AND public.is_conversation_member(conversation_id, auth.uid())
  AND public.is_conversation_member(conversation_id, to_user)
);
CREATE POLICY "cleanup own call signals" ON public.call_signals FOR DELETE TO authenticated
USING (from_user = auth.uid() OR to_user = auth.uid());

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.call_log;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.call_signals;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Missed-call notification: server-side insert so a caller can only notify
-- someone they actually share a conversation with.
CREATE OR REPLACE FUNCTION public.notify_missed_call(_conversation uuid, _callee uuid, _kind text, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'not signed in'; END IF;
  IF NOT public.is_conversation_member(_conversation, _caller) OR NOT public.is_conversation_member(_conversation, _callee) THEN
    RAISE EXCEPTION 'not conversation members';
  END IF;
  INSERT INTO public.user_notifications (user_id, title, body, kind)
  VALUES (
    _callee,
    'Missed ' || _kind || ' call',
    'From ' || COALESCE((SELECT display_name FROM public.profiles WHERE id = _caller), 'a member') ||
      CASE _reason WHEN 'offline' THEN ' · you were offline' WHEN 'no-answer' THEN ' · not answered' ELSE '' END,
    'call'
  );
END $$;
GRANT EXECUTE ON FUNCTION public.notify_missed_call(uuid, uuid, text, text) TO authenticated;
