-- Keep workflow SECURITY DEFINER helpers unavailable to anonymous callers.
revoke execute on function public.log_finishing_status_change() from public, anon;
revoke execute on function public.record_dispatch_status_change() from public, anon;
revoke execute on function public.route_completed_finishing_to_packaging() from public, anon;
revoke execute on function public.sync_packaging_order_stage() from public, anon;
revoke execute on function public.validate_dispatch_readiness() from public, anon;
revoke execute on function public.validate_dispatch_transition() from public, anon;
revoke execute on function public.validate_packing_dispatch_readiness() from public, anon;
alter function private.is_valid_delivery_transition(text, text) set search_path = public, private;
