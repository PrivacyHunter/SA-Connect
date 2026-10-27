alter table public.conversation_keys drop constraint conversation_keys_pkey;
alter table public.conversation_keys add column generation uuid not null default gen_random_uuid();
alter table public.conversation_keys add primary key (conversation_id, user_id, generation);