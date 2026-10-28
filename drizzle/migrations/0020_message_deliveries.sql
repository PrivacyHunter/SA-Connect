create table public.message_deliveries (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

grant select, insert on public.message_deliveries to authenticated;
grant all on public.message_deliveries to service_role;

alter table public.message_deliveries enable row level security;

create policy "members read deliveries"
on public.message_deliveries for select to authenticated
using (exists (
  select 1 from public.messages m
  where m.id = message_id
    and public.is_conversation_member(m.conversation_id, auth.uid())
));

create policy "members mark delivered"
on public.message_deliveries for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.messages m
    where m.id = message_id
      and public.is_conversation_member(m.conversation_id, auth.uid())
  )
);

do $$ begin
  alter publication supabase_realtime add table public.message_deliveries;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.conversation_members;
exception when duplicate_object then null; end $$;