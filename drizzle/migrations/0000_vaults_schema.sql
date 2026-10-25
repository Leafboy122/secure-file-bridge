create table public.vaults (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  password_hash text not null,
  password_salt text not null,
  created_at timestamptz not null default now()
);

create table public.vault_files (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references public.vaults(id) on delete cascade,
  filename text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null,
  content_base64 text not null,
  created_at timestamptz not null default now()
);

create index vault_files_vault_idx on public.vault_files (vault_id, created_at desc);

-- Access is only through server functions that verify the vault name and
-- password; no role gets Data API access, so RLS with no policies locks
-- the tables to everything but service_role.
grant all on public.vaults to service_role;
grant all on public.vault_files to service_role;

alter table public.vaults enable row level security;
alter table public.vault_files enable row level security;