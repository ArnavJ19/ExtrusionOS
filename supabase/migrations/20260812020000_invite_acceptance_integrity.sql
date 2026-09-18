-- Make invitation acceptance a single authorization transaction. Auth identity
-- creation remains external, so the API compensates by deleting a newly created
-- identity whenever this function does not commit access.

begin;

alter table public.app_users
  drop constraint if exists app_users_role_check;

alter table public.app_users
  add constraint app_users_role_check check (
    role in (
      'owner',
      'admin',
      'sales_manager',
      'sales',
      'production_manager',
      'production',
      'dispatch_manager',
      'dispatch',
      'accounts',
      'quality',
      'viewer',
      'factory_manager',
      'inventory_manager',
      'dealer_admin',
      'dealer_staff'
    )
  );

create or replace function public.accept_invitation_atomic(
  target_invitation_id uuid,
  target_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_invitation public.invitations%rowtype;
  selected_role public.roles%rowtype;
begin
  select invitation.*
  into selected_invitation
  from public.invitations invitation
  where invitation.id = target_invitation_id
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if selected_invitation.status = 'accepted' then
    if selected_invitation.accepted_by = target_user_id then
      return jsonb_build_object('status', 'accepted', 'role_key', null);
    end if;
    return jsonb_build_object('status', 'already_accepted');
  end if;

  if selected_invitation.status <> 'pending' then
    return jsonb_build_object('status', 'not_pending');
  end if;

  if selected_invitation.expires_at < now() then
    update public.invitations
    set status = 'expired'
    where id = selected_invitation.id;
    return jsonb_build_object('status', 'expired');
  end if;

  select role.*
  into selected_role
  from public.roles role
  where role.id = selected_invitation.role_id
    and role.company_id = selected_invitation.company_id
    and role.is_active = true
    and role.is_system = true
    and role.role_key = any (array[
      'owner', 'admin', 'sales_manager', 'sales', 'production_manager', 'production',
      'dispatch_manager', 'dispatch', 'accounts', 'quality', 'viewer', 'factory_manager',
      'inventory_manager', 'dealer_admin', 'dealer_staff'
    ]::text[]);

  if not found then
    return jsonb_build_object('status', 'invalid_role');
  end if;

  if selected_invitation.dealer_id is not null and not exists (
    select 1
    from public.dealers dealer
    where dealer.id = selected_invitation.dealer_id
      and dealer.company_id = selected_invitation.company_id
      and dealer.is_active = true
  ) then
    return jsonb_build_object('status', 'invalid_scope');
  end if;

  if selected_invitation.branch_id is not null and not exists (
    select 1
    from public.branches branch
    where branch.id = selected_invitation.branch_id
      and branch.company_id = selected_invitation.company_id
      and branch.is_active = true
  ) then
    return jsonb_build_object('status', 'invalid_scope');
  end if;

  if exists (select 1 from public.app_users app_user where app_user.id = target_user_id) then
    return jsonb_build_object('status', 'user_conflict');
  end if;

  insert into public.app_users (
    id,
    company_id,
    dealer_id,
    branch_id,
    full_name,
    email,
    phone,
    role,
    is_active,
    status,
    invited_by,
    invited_at,
    department,
    sales_region
  ) values (
    target_user_id,
    selected_invitation.company_id,
    selected_invitation.dealer_id,
    selected_invitation.branch_id,
    selected_invitation.full_name,
    lower(selected_invitation.email),
    selected_invitation.phone,
    selected_role.role_key,
    true,
    'active',
    selected_invitation.invited_by,
    selected_invitation.created_at,
    selected_invitation.department,
    selected_invitation.sales_region
  );

  insert into public.user_roles (
    company_id,
    user_id,
    role_id,
    dealer_id,
    branch_id,
    sales_region,
    department,
    is_primary,
    assigned_by
  ) values (
    selected_invitation.company_id,
    target_user_id,
    selected_role.id,
    selected_invitation.dealer_id,
    selected_invitation.branch_id,
    selected_invitation.sales_region,
    selected_invitation.department,
    true,
    selected_invitation.invited_by
  );

  update public.invitations
  set
    status = 'accepted',
    accepted_by = target_user_id,
    accepted_at = now()
  where id = selected_invitation.id;

  return jsonb_build_object('status', 'accepted', 'role_key', selected_role.role_key);
end;
$$;

revoke all on function public.accept_invitation_atomic(uuid, uuid) from public, anon, authenticated;
grant execute on function public.accept_invitation_atomic(uuid, uuid) to service_role;

commit;
