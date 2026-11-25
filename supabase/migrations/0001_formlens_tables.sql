-- FormLens Supabase Migration
-- Run with: supabase db push (or paste in Supabase SQL Editor)

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Forms table
create table if not exists public.forms (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  template_id text not null,
  status text not null check (status in ('draft', 'reviewed', 'synced')),
  avg_confidence real not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Form fields table (keeps original_text for retraining)
create table if not exists public.form_fields (
  id uuid primary key default uuid_generate_v4(),
  form_id uuid references public.forms(id) on delete cascade not null,
  field_name text not null,
  text_value text not null default '',
  original_text text not null default '',
  confidence real not null default 0,
  was_edited boolean not null default false,
  created_at timestamptz not null default now()
);

-- Row Level Security: users can only access their own rows

alter table public.forms enable row level security;
alter table public.form_fields enable row level security;

-- Forms policies
create policy "Users read own forms"
  on public.forms for select
  using (auth.uid() = user_id);

create policy "Users insert own forms"
  on public.forms for insert
  with check (auth.uid() = user_id);

create policy "Users update own forms"
  on public.forms for update
  using (auth.uid() = user_id);

create policy "Users delete own forms"
  on public.forms for delete
  using (auth.uid() = user_id);

-- Form fields policies (access via form ownership)
create policy "Users read own form fields"
  on public.form_fields for select
  using (
    exists (
      select 1 from public.forms
      where forms.id = form_fields.form_id
        and forms.user_id = auth.uid()
    )
  );

create policy "Users insert own form fields"
  on public.form_fields for insert
  with check (
    exists (
      select 1 from public.forms
      where forms.id = form_fields.form_id
        and forms.user_id = auth.uid()
    )
  );

create policy "Users update own form fields"
  on public.form_fields for update
  using (
    exists (
      select 1 from public.forms
      where forms.id = form_fields.form_id
        and forms.user_id = auth.uid()
    )
  );

create policy "Users delete own form fields"
  on public.form_fields for delete
  using (
    exists (
      select 1 from public.forms
      where forms.id = form_fields.form_id
        and forms.user_id = auth.uid()
    )
  );

-- Private storage bucket for form images
-- Run in Supabase Dashboard > Storage > New bucket (private):
--   Name: form-images
--   Public: false
-- Or via Supabase CLI:
-- insert into storage.buckets (id, name, public)
-- values ('form-images', 'form-images', false)
-- on conflict (id) do nothing;

-- Indexes for common queries
create index if not exists forms_user_id_idx on public.forms(user_id);
create index if not exists forms_updated_at_idx on public.forms(updated_at desc);
create index if not exists form_fields_form_id_idx on public.form_fields(form_id);

-- Updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger forms_set_updated_at
  before update on public.forms
  for each row execute function public.set_updated_at();

