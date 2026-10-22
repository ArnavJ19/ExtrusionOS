import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";

// Rebuilds a database from nothing: Supabase platform stand-ins, the declared baseline
// (schema.sql, rls.sql), then every migration in file-name order. Local and in-memory only.
const supabaseDir = new URL("../../supabase/", import.meta.url);
export const baselineFiles = ["schema.sql", "rls.sql"];
export const migrationFiles = () => readdirSync(new URL("migrations/", supabaseDir)).filter(name => name.endsWith(".sql")).sort();

const platform = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create role supabase_admin; create role authenticator;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  create schema auth; create schema storage; create schema extensions; create schema private;
  create extension pgcrypto schema extensions; create extension "uuid-ossp" schema extensions;
  set search_path = "$user", public, extensions;
  create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb, raw_app_meta_data jsonb, created_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role', true) $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.email() returns text language sql stable as $$ select auth.jwt()->>'email' $$;
  create table storage.buckets(id text primary key, name text, owner uuid, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
    name text, owner uuid, metadata jsonb, path_tokens text[] generated always as (string_to_array(name, '/')) stored,
    created_at timestamptz default now(), updated_at timestamptz default now());
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  create function storage.filename(name text) returns text language sql immutable as $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
  create function storage.extension(name text) returns text language sql immutable as $$ select reverse(split_part(reverse(name), '.', 1)) $$;
`;

export async function replayMigrationChain({ stopOnFailure = true } = {}) {
  const db = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
  await db.exec(platform);
  const files = [...baselineFiles, ...migrationFiles().map(name => `migrations/${name}`)];
  const failures = [];
  let applied = 0;
  for (const file of files) {
    try {
      await db.exec(readFileSync(new URL(file, supabaseDir), "utf8"));
      applied++;
    } catch (error) {
      failures.push({ file, message: error.message, detail: error.detail });
      try { await db.exec("rollback"); } catch {}
      if (stopOnFailure) break;
    }
  }
  return { db, files, applied, failures };
}
