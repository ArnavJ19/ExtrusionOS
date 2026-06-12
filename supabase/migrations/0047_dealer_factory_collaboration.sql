-- Dealer-factory collaboration: ETA commitment, clarification workflow, comments, and notifications.

alter table public.dealer_orders
  add column if not exists factory_committed_date date,
  add column if not exists clarification_required_at timestamptz,
  add column if not exists clarification_resolved_at timestamptz,
  add column if not exists last_factory_update_at timestamptz;

create table if not exists public.dealer_order_comments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  dealer_order_id uuid not null references public.dealer_orders(id) on delete cascade,
  comment_text text not null,
  visibility text not null default 'dealer_factory' check (visibility in ('dealer_factory','factory_only')),
  created_by uuid references auth.users(id),
  created_by_role text,
  created_at timestamptz not null default now()
);

create index if not exists dealer_order_comments_order_idx on public.dealer_order_comments(company_id, dealer_order_id, created_at desc);
alter table public.dealer_order_comments enable row level security;

drop policy if exists "dealer order comments tenant read" on public.dealer_order_comments;
create policy "dealer order comments tenant read" on public.dealer_order_comments for select using (
  exists (
    select 1 from public.dealer_orders o
    where o.id = dealer_order_comments.dealer_order_id
      and o.company_id = public.get_current_user_company_id()
      and (
        (public.get_current_user_dealer_id() is not null and o.dealer_id = public.get_current_user_dealer_id() and dealer_order_comments.visibility = 'dealer_factory')
        or (public.get_current_user_dealer_id() is null and public.current_user_has_permission('view_orders'))
      )
  )
);

drop policy if exists "dealer order comments tenant insert" on public.dealer_order_comments;
create policy "dealer order comments tenant insert" on public.dealer_order_comments for insert with check (
  company_id = public.get_current_user_company_id()
  and exists (
    select 1 from public.dealer_orders o
    where o.id = dealer_order_comments.dealer_order_id
      and o.company_id = dealer_order_comments.company_id
      and (
        (public.get_current_user_dealer_id() is not null and o.dealer_id = public.get_current_user_dealer_id() and visibility = 'dealer_factory')
        or (public.get_current_user_dealer_id() is null and public.current_user_has_permission('view_orders'))
      )
  )
);

drop policy if exists "dealer order status history tenant read" on public.dealer_order_status_history;
create policy "dealer order status history tenant read" on public.dealer_order_status_history for select using (
  exists (
    select 1 from public.dealer_orders o
    where o.id = dealer_order_status_history.dealer_order_id
      and o.company_id = public.get_current_user_company_id()
      and (
        (public.get_current_user_dealer_id() is not null and o.dealer_id = public.get_current_user_dealer_id())
        or (public.get_current_user_dealer_id() is null and public.current_user_has_permission('view_orders'))
      )
  )
);

drop policy if exists "dealer order status history tenant insert" on public.dealer_order_status_history;
create policy "dealer order status history tenant insert" on public.dealer_order_status_history for insert with check (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_dealer_id() is null
  and public.current_user_has_permission('edit_orders')
);
