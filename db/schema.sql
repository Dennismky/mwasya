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
