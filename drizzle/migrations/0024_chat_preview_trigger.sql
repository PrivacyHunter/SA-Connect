-- Keep conversations.last_message_at / last_message_body in sync so the chat
-- list shows a live preview for every message kind (text, photo, voice, sticker, GIF, file).
CREATE OR REPLACE FUNCTION public.messages_touch_conversation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  preview text;
BEGIN
  IF NEW.deleted_for_everyone THEN
    preview := 'This message was deleted';
  ELSE
    preview := CASE NEW.kind
      WHEN 'text' THEN COALESCE(NEW.body, 'Message')
      WHEN 'image' THEN '🖼️ Photo'
      WHEN 'voice' THEN '🎤 Voice note'
      WHEN 'sticker' THEN '🖼️ Sticker'
      WHEN 'gif' THEN 'GIF'
      WHEN 'file' THEN '📎 ' || COALESCE(NEW.file_name, 'File')
      ELSE '💬 Message'
    END;
  END IF;
  UPDATE public.conversations
  SET last_message_at = NEW.created_at,
      last_message_body = preview
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END $$;

CREATE TRIGGER messages_touch_conversation
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.messages_touch_conversation();

-- When the newest message is deleted for everyone, its preview reflects that.
CREATE OR REPLACE FUNCTION public.messages_deleted_preview() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.deleted_for_everyone AND NOT EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.conversation_id = NEW.conversation_id AND m.created_at > NEW.created_at
  ) THEN
    UPDATE public.conversations
    SET last_message_body = 'This message was deleted'
    WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER messages_deleted_preview
AFTER UPDATE OF deleted_for_everyone ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.messages_deleted_preview();
