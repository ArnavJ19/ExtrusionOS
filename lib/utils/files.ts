import { createClient } from "@/lib/supabase/browser";
import { getStorageObjectPath } from "@/lib/utils/storage-path";

export { getStorageObjectPath } from "@/lib/utils/storage-path";

const maxUploadBytes = 10 * 1024 * 1024;
const allowedMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);
const dangerousExtensions = /\.(?:bat|cmd|com|exe|hta|js|jse|msi|ps1|scr|sh|vbs|wsf)$/i;

function assertSafeUpload(file: File) {
  if (file.size > maxUploadBytes) throw new Error("File size must be 10 MB or less");
  if (dangerousExtensions.test(file.name)) throw new Error("This file type is not allowed");
  if (file.type && !allowedMimeTypes.has(file.type)) throw new Error("Unsupported file type");
}

/** Upload a file and return its durable object path, never an expiring URL. */
export async function uploadTenantFile(bucket: string, companyId: string, folder: string, file: File) {
  assertSafeUpload(file);
  const supabase = createClient();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `${companyId}/${folder}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}

export async function removeTenantFile(bucket: string, pathOrUrl: string) {
  const path = getStorageObjectPath(bucket, pathOrUrl);
  if (!path) return;
  const supabase = createClient();
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw error;
}

/**
 * Get a fresh signed URL for an existing storage path.
 * Use this when displaying files that were previously uploaded.
 */
export async function getSignedFileUrl(bucket: string, path: string, ttlSeconds = 3600) {
  const cleanPath = getStorageObjectPath(bucket, path);
  if (!cleanPath) return path;
  const supabase = createClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(cleanPath, ttlSeconds);
  if (error || !data?.signedUrl) throw error ?? new Error("Could not generate signed URL");
  return data.signedUrl;
}
