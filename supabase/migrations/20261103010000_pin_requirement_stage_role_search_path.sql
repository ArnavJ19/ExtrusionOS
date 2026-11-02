-- Advisor 0011: pin search_path on private.requirement_stage_role (uses only built-ins).
alter function private.requirement_stage_role(text,text) set search_path=pg_catalog;
