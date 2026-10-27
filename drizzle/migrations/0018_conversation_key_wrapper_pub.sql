alter table public.conversation_keys add column wrapper_public_key text;
update public.conversation_keys ck
set wrapper_public_key = p.public_key
from public.profiles p
where p.id = ck.wrapped_by
  and ck.wrapper_public_key is null;