-- AP-019: customer deletion must not erase portal, request, support or compliance
-- history. Deactivate a referenced customer instead. NO ACTION checks at the end
-- of the statement, preserving a company offboarding cascade that removes both
-- the customer and its company-scoped children together.
begin;
set local lock_timeout = '5s';

alter table public.portal_users drop constraint portal_users_customer_id_fkey;
alter table public.portal_users add constraint portal_users_customer_id_fkey
  foreign key (customer_id) references public.customers(id) on delete no action not valid;
alter table public.portal_users validate constraint portal_users_customer_id_fkey;

alter table public.quote_requests drop constraint quote_requests_customer_id_fkey;
alter table public.quote_requests add constraint quote_requests_customer_id_fkey
  foreign key (customer_id) references public.customers(id) on delete no action not valid;
alter table public.quote_requests validate constraint quote_requests_customer_id_fkey;

alter table public.support_tickets drop constraint support_tickets_customer_id_fkey;
alter table public.support_tickets add constraint support_tickets_customer_id_fkey
  foreign key (customer_id) references public.customers(id) on delete no action not valid;
alter table public.support_tickets validate constraint support_tickets_customer_id_fkey;

alter table public.customer_compliance_requirements drop constraint customer_compliance_requirements_customer_id_fkey;
alter table public.customer_compliance_requirements add constraint customer_compliance_requirements_customer_id_fkey
  foreign key (customer_id) references public.customers(id) on delete no action not valid;
alter table public.customer_compliance_requirements validate constraint customer_compliance_requirements_customer_id_fkey;

commit;
