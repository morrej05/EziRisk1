/*
  # Add signup_attempts table for lightweight signup abuse protection

  ## Purpose
  - Track signup attempts by IP so Edge Function can enforce rolling rate limits.
  - Keep schema minimal for launch-stage anti-spam controls.
*/

create table if not exists public.signup_attempts (
  id uuid primary key default gen_random_uuid(),
  ip_address text not null,
  email text,
  attempted_at timestamptz not null default now()
);

create index if not exists idx_signup_attempts_ip_attempted_at
  on public.signup_attempts (ip_address, attempted_at desc);

alter table public.signup_attempts enable row level security;

-- No public policies: table is only accessed by service-role in Edge Functions.
