-- These SECURITY DEFINER functions are trigger implementations, not RPCs.
-- PostgreSQL triggers do not require callers to hold EXECUTE on the function.
revoke execute on function public.log_finishing_status_change() from public, anon, authenticated;
revoke execute on function public.record_dispatch_status_change() from public, anon, authenticated;
revoke execute on function public.route_completed_finishing_to_packaging() from public, anon, authenticated;
revoke execute on function public.sync_packaging_order_stage() from public, anon, authenticated;
revoke execute on function public.validate_dispatch_readiness() from public, anon, authenticated;
revoke execute on function public.validate_dispatch_transition() from public, anon, authenticated;
revoke execute on function public.validate_packing_dispatch_readiness() from public, anon, authenticated;
