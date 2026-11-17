begin;

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  description text not null check (char_length(btrim(description)) > 0),
  amount numeric(14, 2) not null check (amount > 0),
  type text not null check (type in ('income', 'expense')),
  category text not null check (char_length(btrim(category)) > 0),
  payment text not null check (char_length(btrim(payment)) > 0),
  date date not null,
  created_at timestamptz not null default now(),
  legacy_id text,
  constraint transactions_user_legacy_id_unique unique (user_id, legacy_id)
);

create index if not exists transactions_user_date_idx
  on public.transactions (user_id, date desc);

create index if not exists transactions_user_created_at_idx
  on public.transactions (user_id, created_at desc);

create table if not exists public.monthly_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  amount numeric(14, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monthly_budgets_user_month_unique unique (user_id, month)
);

create or replace function public.set_monthly_budget_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.set_monthly_budget_updated_at() from public, anon, authenticated;

drop trigger if exists monthly_budgets_set_updated_at on public.monthly_budgets;
create trigger monthly_budgets_set_updated_at
  before update on public.monthly_budgets
  for each row
  execute function public.set_monthly_budget_updated_at();

create table if not exists public.user_migrations (
  user_id uuid not null references auth.users (id) on delete cascade,
  migration_key text not null,
  imported_transactions integer not null default 0 check (imported_transactions >= 0),
  budget_imported boolean not null default false,
  completed_at timestamptz not null default now(),
  primary key (user_id, migration_key)
);

alter table public.transactions enable row level security;
alter table public.monthly_budgets enable row level security;
alter table public.user_migrations enable row level security;

revoke all on table public.transactions from public, anon, authenticated;
revoke all on table public.monthly_budgets from public, anon, authenticated;
revoke all on table public.user_migrations from public, anon, authenticated;

grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.transactions to authenticated;
grant select, insert, update, delete on table public.monthly_budgets to authenticated;
grant select, insert on table public.user_migrations to authenticated;

drop policy if exists transactions_select_own on public.transactions;
create policy transactions_select_own
  on public.transactions for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists transactions_insert_own on public.transactions;
create policy transactions_insert_own
  on public.transactions for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists transactions_update_own on public.transactions;
create policy transactions_update_own
  on public.transactions for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists transactions_delete_own on public.transactions;
create policy transactions_delete_own
  on public.transactions for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists monthly_budgets_select_own on public.monthly_budgets;
create policy monthly_budgets_select_own
  on public.monthly_budgets for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists monthly_budgets_insert_own on public.monthly_budgets;
create policy monthly_budgets_insert_own
  on public.monthly_budgets for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists monthly_budgets_update_own on public.monthly_budgets;
create policy monthly_budgets_update_own
  on public.monthly_budgets for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists monthly_budgets_delete_own on public.monthly_budgets;
create policy monthly_budgets_delete_own
  on public.monthly_budgets for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_migrations_select_own on public.user_migrations;
create policy user_migrations_select_own
  on public.user_migrations for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_migrations_insert_own on public.user_migrations;
create policy user_migrations_insert_own
  on public.user_migrations for insert to authenticated
  with check ((select auth.uid()) = user_id);

commit;
