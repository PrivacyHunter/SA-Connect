CREATE OR REPLACE FUNCTION public.block_disposable_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d text := lower(split_part(coalesce(NEW.email,''), '@', 2));
BEGIN
  IF d = ANY (ARRAY['mailinator.com','tempmail.com','temp-mail.org','temp-mail.io','10minutemail.com','10minutemail.net','guerrillamail.com','guerrillamail.net','guerrillamail.org','sharklasers.com','grr.la','yopmail.com','yopmail.net','trashmail.com','getnada.com','nada.email','dispostable.com','maildrop.cc','throwawaymail.com','fakeinbox.com','mohmal.com','emailondeck.com','mintemail.com','mytemp.email','tempmailo.com','tempail.com','tempr.email','discard.email','spamgourmet.com','mailnesia.com','burnermail.io','moakt.com','emailfake.com','fakemail.net','inboxkitten.com','mail.tm','mail.gw','tmpmail.org','tmpmail.net','minuteinbox.com','33mail.com','spambox.us','trbvm.com','linshiyouxiang.net','byom.de','mailpoof.com','dropmail.me','1secmail.com','1secmail.org','1secmail.net','emltmp.com','tempmail.plus','harakirimail.com','luxusmail.org']) THEN
    RAISE EXCEPTION 'Temporary or disposable email addresses are not allowed';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.block_disposable_email() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS block_disposable_email ON auth.users;
CREATE TRIGGER block_disposable_email BEFORE INSERT OR UPDATE OF email ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.block_disposable_email();