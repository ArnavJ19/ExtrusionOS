import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getStorageObjectPath } from "../lib/utils/storage-path.ts";
import { sendEmail } from "../lib/communications/email.ts";

const repoRoot = process.cwd();

test("technical document paths remain durable and legacy Supabase URLs are parsed", async () => {
  const objectPath = "company-id/die/die-id/document.pdf";
  assert.equal(getStorageObjectPath("documents", objectPath), objectPath);
  assert.equal(
    getStorageObjectPath(
      "documents",
      `https://project.supabase.co/storage/v1/object/sign/documents/${objectPath}?token=expired`
    ),
    objectPath
  );
  assert.equal(
    getStorageObjectPath("documents", `https://project.supabase.co/storage/v1/object/public/documents/${objectPath}`),
    objectPath
  );
  assert.equal(getStorageObjectPath("documents", "https://files.example.com/legacy.pdf"), null);
});

test("technical document uploads persist paths and remove orphaned objects on metadata failure", () => {
  const uploadHelper = readFileSync(join(repoRoot, "lib/utils/files.ts"), "utf8");
  const uploader = readFileSync(join(repoRoot, "components/modules/shared/technical-document-upload.tsx"), "utf8");

  assert.match(uploadHelper, /return path;/);
  assert.doesNotMatch(uploadHelper.slice(uploadHelper.indexOf("export async function uploadTenantFile"), uploadHelper.indexOf("export async function removeTenantFile")), /createSignedUrl/);
  assert.match(uploader, /file_url:\s*storagePath/);
  assert.match(uploader, /storage_bucket:\s*"documents"/);
  assert.match(uploader, /storage_path:\s*storagePath/);
  assert.match(uploader, /if \(error\) \{[\s\S]*removeTenantFile\("documents", storagePath\)/);
});

test("documents bucket is private and tenant-scoped for every storage operation", () => {
  const migration = readFileSync(
    join(repoRoot, "supabase/migrations/20260715020000_documents_storage_bucket.sql"),
    "utf8"
  );

  assert.match(migration, /values \('documents', 'documents', false\)/);
  assert.match(migration, /add column if not exists storage_path text/);
  assert.match(migration, /split_part\(storage_path, '\/', 1\) = company_id::text/);
  for (const operation of ["select", "insert", "update", "delete"]) {
    assert.match(migration, new RegExp(`for ${operation}[\\s\\S]*?bucket_id = 'documents'`, "i"));
  }
  assert.equal((migration.match(/public\.get_current_user_company_id\(\)/g) ?? []).length >= 5, true);
});

test("invite email falls back to Resend when a webhook is incomplete", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    EMAIL_WEBHOOK_URL: process.env.EMAIL_WEBHOOK_URL,
    EMAIL_WEBHOOK_SECRET: process.env.EMAIL_WEBHOOK_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM
  };
  const requests = [];

  try {
    process.env.EMAIL_WEBHOOK_URL = "http://localhost:3000/api/email/send";
    delete process.env.EMAIL_WEBHOOK_SECRET;
    process.env.RESEND_API_KEY = "test-key";
    process.env.EMAIL_FROM = "ExtrusionOS <test@example.com>";
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: "email-id" }), { status: 200 });
    };

    const result = await sendEmail({ to: "owner@example.com", subject: "Invite", text: "Welcome" });
    assert.deepEqual(result, { success: true, provider: "resend", id: "email-id" });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://api.resend.com/emails");
    assert.equal(requests[0].init.headers.authorization, "Bearer test-key");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("email webhook calls require an explicitly configured matching secret", () => {
  const route = readFileSync(join(repoRoot, "app/api/email/send/route.ts"), "utf8");
  const envExample = readFileSync(join(repoRoot, ".env.example"), "utf8");

  assert.match(route, /suppliedSecret && \(!webhookSecret \|\| suppliedSecret !== webhookSecret\)/);
  assert.match(route, /if \(!isWebhookCall\) \{[\s\S]*getSessionContext\(\)/);
  assert.match(envExample, /RESEND_API_KEY=/);
  assert.match(envExample, /EMAIL_FROM=/);
  assert.match(envExample, /EMAIL_WEBHOOK_URL=/);
  assert.match(envExample, /EMAIL_WEBHOOK_SECRET=/);
});
