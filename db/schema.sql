-- Mwasya Postgres schema. Idempotent: safe to run repeatedly (npm run db:migrate).

create extension if not exists pgcrypto;

-- An operator is a person who logged in with Deriv. Deriv exposes no user id to
-- third-party apps, so an operator is identified by the trading accounts they own.
create table if not exists operators (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now()
);

create table if not exists operator_accounts (
  account_id   text primary key,               -- e.g. DOT90004580
  operator_id  uuid not null references operators(id) on delete cascade,
  account_type text not null check (account_type in ('demo', 'real')),
  currency     text,
  seen_at      timestamptz not null default now()
);
create index if not exists operator_accounts_operator_idx on operator_accounts(operator_id);

create table if not exists bots (
  id           uuid primary key default gen_random_uuid(),
  operator_id  uuid not null references operators(id) on delete cascade,
  name         text not null check (length(name) between 1 and 80),
  spec         jsonb not null,                  -- BotSpec (src/shared/botSpec.ts), validated server-side
  risk         text not null check (risk in ('low', 'medium', 'high')),
  status       text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists bots_operator_idx on bots(operator_id, updated_at desc);
create index if not exists bots_published_idx on bots(status) where status = 'published';

-- Every auto_start we proxy/observe, so operators can see bot usage.
create table if not exists bot_runs (
  run_id       text primary key,                -- Deriv run id, e.g. atr_...
  bot_id       uuid references bots(id) on delete set null,
  account_id   text not null,
  started_at   timestamptz not null default now(),
  status       text not null default 'running',
  total_stake  numeric,
  total_payout numeric,
  updated_at   timestamptz not null default now()
);
create index if not exists bot_runs_bot_idx on bot_runs(bot_id);

-- One branded trader site per operator, served at <subdomain>.mwasya.site.
-- Traders log in through the operator's own Deriv app (so markup goes to the operator).
create table if not exists sites (
  id            uuid primary key default gen_random_uuid(),
  operator_id   uuid not null unique references operators(id) on delete cascade,
  name          text not null check (length(name) between 2 and 40),
  subdomain     text not null unique check (subdomain ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$'),
  accent        text not null default '#1F4FD1' check (accent ~ '^#[0-9A-Fa-f]{6}$'),
  theme         text not null default 'light' check (theme in ('light', 'dark')),
  deriv_app_id  text not null check (deriv_app_id ~ '^[A-Za-z0-9_-]{2,64}$'),
  markup        numeric(3,1) not null default 0 check (markup between 0 and 3),
  status        text not null default 'live' check (status in ('live', 'paused')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table bot_runs add column if not exists site_id uuid references sites(id) on delete set null;
