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

-- ---------- Network (operators under operators), billing, security ----------

-- Tree: the platform owner is the root; every operator has a parent (who invited them).
alter table operators add column if not exists role text not null default 'operator' check (role in ('owner', 'operator'));
alter table operators add column if not exists parent_id uuid references operators(id) on delete set null;
alter table operators add column if not exists status text not null default 'active' check (status in ('active', 'suspended'));
alter table operators add column if not exists paid_until timestamptz;
alter table operators add column if not exists last_login_at timestamptz;
alter table operators add column if not exists phone text;
create index if not exists operators_parent_idx on operators(parent_id);
create index if not exists operators_created_idx on operators(created_at desc);
create unique index if not exists operators_single_owner on operators(role) where role = 'owner';
create index if not exists sites_name_idx on sites(lower(name));

-- Invite links: mwasya.site/?invite=CODE. New operators who log in through one are placed under the inviter.
create table if not exists invites (
  code         text primary key check (code ~ '^[A-Za-z0-9_-]{10,40}$'),
  operator_id  uuid not null references operators(id) on delete cascade,
  max_uses     integer not null default 100 check (max_uses between 1 and 1000),
  uses         integer not null default 0,
  revoked      boolean not null default false,
  expires_at   timestamptz not null default now() + interval '90 days',
  created_at   timestamptz not null default now()
);
create index if not exists invites_operator_idx on invites(operator_id);

-- Platform settings (owner-editable). billing.price_kes = 0 means free.
create table if not exists settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
insert into settings (key, value) values ('billing', '{"price_kes": 0, "period_days": 30}') on conflict (key) do nothing;

-- M-Pesa (Daraja STK push) payments.
create table if not exists payments (
  id                   uuid primary key default gen_random_uuid(),
  operator_id          uuid not null references operators(id) on delete cascade,
  phone                text not null check (phone ~ '^254[17][0-9]{8}$'),
  amount               integer not null check (amount > 0),
  period_days          integer not null check (period_days > 0),
  status               text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled')),
  merchant_request_id  text,
  checkout_request_id  text unique,
  mpesa_receipt        text unique,
  result_code          text,
  result_desc          text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists payments_operator_idx on payments(operator_id, created_at desc);
create index if not exists payments_pending_idx on payments(status, created_at) where status = 'pending';

-- Fixed-window rate limits (login, payments, invites).
create table if not exists rate_limits (
  key          text primary key,
  window_start timestamptz not null,
  count        integer not null
);

-- Who did what (admin actions, payments). Append-only.
create table if not exists audit_log (
  id           bigserial primary key,
  actor_id     uuid references operators(id) on delete set null,
  action       text not null,
  target_id    uuid,
  meta         jsonb not null default '{}',
  created_at   timestamptz not null default now()
);
create index if not exists audit_log_target_idx on audit_log(target_id, created_at desc);

-- ---------- XML bots, support, profile/settings ----------

-- Deriv Bot (DBot) XML strategies operators share with their traders. Stored as text, never parsed
-- server-side, always served as a download (attachment) — see api/platform.ts.
create table if not exists xml_bots (
  id           uuid primary key default gen_random_uuid(),
  operator_id  uuid not null references operators(id) on delete cascade,
  name         text not null check (length(name) between 1 and 80),
  description  text not null default '' check (length(description) <= 500),
  xml          text not null check (length(xml) <= 400000),
  status       text not null default 'draft' check (status in ('draft', 'published')),
  downloads    integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists xml_bots_operator_idx on xml_bots(operator_id, updated_at desc);

-- Support tickets: operators write to the platform owner.
create table if not exists tickets (
  id           uuid primary key default gen_random_uuid(),
  operator_id  uuid not null references operators(id) on delete cascade,
  subject      text not null check (length(subject) between 3 and 120),
  status       text not null default 'open' check (status in ('open', 'answered', 'closed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists tickets_operator_idx on tickets(operator_id, updated_at desc);
create index if not exists tickets_status_idx on tickets(status, updated_at desc);

create table if not exists ticket_messages (
  id          bigserial primary key,
  ticket_id   uuid not null references tickets(id) on delete cascade,
  author_id   uuid references operators(id) on delete set null,
  from_owner  boolean not null default false,
  body        text not null check (length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index if not exists ticket_messages_ticket_idx on ticket_messages(ticket_id, id);

-- Profile + preferences.
alter table operators add column if not exists display_name text check (display_name is null or length(display_name) <= 60);
alter table operators add column if not exists contact text check (contact is null or length(contact) <= 120);
alter table operators add column if not exists language text not null default 'en' check (language in ('en', 'sw', 'fr'));

-- Owner support contacts shown on everyone's Support page.
insert into settings (key, value) values ('support', '{"whatsapp": "", "telegram": "", "email": ""}') on conflict (key) do nothing;

-- ---------- Custom domains + commission snapshots ----------

-- A mentor's trading site can also live on their own domain (e.g. trade.theirbrand.com).
alter table sites add column if not exists custom_domain text unique check (custom_domain is null or custom_domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$');
alter table sites add column if not exists domain_status text not null default 'none' check (domain_status in ('none', 'pending', 'verified', 'error'));
alter table sites add column if not exists domain_checked_at timestamptz;

-- Latest markup figures per mentor (from Deriv markup-statistics with the mentor's own token).
-- Lets the owner (and uplines) see each mentor's commission without holding their tokens.
create table if not exists operator_earnings (
  operator_id   uuid primary key references operators(id) on delete cascade,
  markup_30d    numeric not null default 0,
  volume_30d    numeric not null default 0,
  contracts_30d integer not null default 0,
  clients_30d   integer not null default 0,
  breakdown     jsonb not null default '[]',
  fetched_at    timestamptz not null default now()
);

-- ---------- Domain purchases (mentor pays with M-Pesa → we register via Vercel → auto-connect) ----------

alter table payments add column if not exists purpose text not null default 'access' check (purpose in ('access', 'domain'));

create table if not exists domain_orders (
  id               uuid primary key default gen_random_uuid(),
  operator_id      uuid not null references operators(id) on delete cascade,
  domain           text not null,
  years            integer not null default 1 check (years between 1 and 10),
  usd_price        numeric not null check (usd_price > 0),
  kes_amount       integer not null check (kes_amount >= 0),
  payment_id       uuid unique references payments(id) on delete set null,
  contact          jsonb not null,
  status           text not null default 'awaiting_payment'
                   check (status in ('awaiting_payment', 'paid', 'purchasing', 'completed', 'failed', 'needs_review', 'cancelled')),
  vercel_order_id  text,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists domain_orders_operator_idx on domain_orders(operator_id, created_at desc);
create index if not exists domain_orders_status_idx on domain_orders(status, updated_at);
-- One live order per domain at a time.
create unique index if not exists domain_orders_active_domain on domain_orders(domain)
  where status in ('awaiting_payment', 'paid', 'purchasing', 'completed', 'needs_review');

-- Owner settings: enabled, KES per USD, margin on top of Vercel's price, max Vercel price we'll buy at.
insert into settings (key, value) values ('domains', '{"enabled": false, "kes_per_usd": 130, "margin_pct": 20, "max_usd": 60}') on conflict (key) do nothing;

-- ---------- Many sites per mentor, site builder config, shared bot catalog ----------

alter table sites drop constraint if exists sites_operator_id_key;
create index if not exists sites_operator_idx on sites(operator_id, created_at);
alter table sites drop constraint if exists sites_status_check;
alter table sites add constraint sites_status_check check (status in ('draft', 'live', 'paused'));
alter table sites alter column deriv_app_id drop not null;
alter table sites drop constraint if exists sites_deriv_app_id_check;
alter table sites add constraint sites_deriv_app_id_check check (deriv_app_id is null or deriv_app_id ~ '^[A-Za-z0-9_-]{2,64}$');
-- Logo: small PNG/JPEG/WebP data URL (SVG is refused — it can carry scripts).
alter table sites add column if not exists logo text check (logo is null or (length(logo) <= 200000 and logo ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'));
alter table sites add column if not exists template text not null default 'bothub' check (template in ('bothub', 'signaldesk', 'chartfloor', 'primedesk', 'nightmarket'));
alter table sites add column if not exists features jsonb not null default '["bots","manual","charts","analysis","risk","learn"]';
alter table sites add column if not exists free_bots jsonb not null default '[]';
alter table sites add column if not exists tagline text check (tagline is null or length(tagline) <= 120);

-- The owner's XML bots marked catalog=true can be offered on every mentor's site.
alter table xml_bots add column if not exists catalog boolean not null default false;
create index if not exists xml_bots_catalog_idx on xml_bots(catalog) where catalog;

alter table domain_orders add column if not exists site_id uuid references sites(id) on delete set null;

-- One "main" site per operator (first live, else first) for lists that show one row per person.
drop view if exists operator_primary_site;
create view operator_primary_site as
select distinct on (s.operator_id) s.*, count(*) over (partition by s.operator_id) as site_count
  from sites s
 order by s.operator_id, (s.status = 'live') desc, s.created_at;

-- ---------- "Ready for clients": proof that client login works on each address ----------
alter table sites add column if not exists client_logins integer not null default 0;
alter table sites add column if not exists sub_login_at timestamptz;     -- last successful client login on <sub>.mwasya.site
alter table sites add column if not exists domain_login_at timestamptz;  -- last successful client login on the custom domain

-- ---------- Monthly mentor fees (due 10th–13th, shown in USD, paid via M-Pesa) ----------

-- Agreement per mentor: fixed KES amount (default 1,000), a % of last month's Deriv commission, or none.
alter table operators add column if not exists fee_mode text not null default 'fixed' check (fee_mode in ('fixed', 'percent', 'none'));
alter table operators add column if not exists fee_kes integer not null default 1000 check (fee_kes between 0 and 1000000);
alter table operators add column if not exists fee_pct numeric(5,2) not null default 0 check (fee_pct between 0 and 100);

-- Commission per calendar month (from the mentor's own markup statistics), for % fees and verification.
create table if not exists operator_monthly_earnings (
  operator_id  uuid not null references operators(id) on delete cascade,
  month        date not null,               -- first day of the month
  markup_usd   numeric not null default 0,
  volume_usd   numeric not null default 0,
  contracts    integer not null default 0,
  clients      integer not null default 0,
  fetched_at   timestamptz not null default now(),
  primary key (operator_id, month)
);

create table if not exists dues (
  id           uuid primary key default gen_random_uuid(),
  operator_id  uuid not null references operators(id) on delete cascade,
  period       date not null,                -- first day of the month the fee is for
  amount_usd   numeric(12,2) not null check (amount_usd >= 0),
  amount_kes   integer not null check (amount_kes >= 0),
  basis        jsonb not null default '{}',  -- {mode, fee_kes | pct + markup_usd, kes_per_usd}
  status       text not null default 'due' check (status in ('due', 'pending_review', 'paid', 'waived')),
  paid_via     text check (paid_via in ('mpesa_stk', 'send_money', 'manual')),
  mpesa_code   text check (mpesa_code is null or mpesa_code ~ '^[A-Z0-9]{8,12}$'),
  payment_id   uuid references payments(id) on delete set null,
  paid_at      timestamptz,
  note         text check (note is null or length(note) <= 300),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (operator_id, period)
);
create index if not exists dues_status_idx on dues(status, period);
create unique index if not exists dues_mpesa_code_idx on dues(mpesa_code) where mpesa_code is not null;

alter table payments drop constraint if exists payments_purpose_check;
alter table payments add constraint payments_purpose_check check (purpose in ('access', 'domain', 'due'));

-- Owner settings for fees: where Send Money goes, rate for USD↔KES.
insert into settings (key, value) values ('fees', '{"enabled": true, "send_money_phone": "", "send_money_name": "", "kes_per_usd": 130}') on conflict (key) do nothing;
