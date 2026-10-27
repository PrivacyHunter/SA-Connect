ALTER TABLE public.user_reports ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open';
ALTER TABLE public.user_reports DROP CONSTRAINT IF EXISTS user_reports_status_check;
ALTER TABLE public.user_reports ADD CONSTRAINT user_reports_status_check CHECK (status IN ('open','resolved','dismissed'));