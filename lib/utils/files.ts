import { createClient } from "@/lib/supabase/browser";

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

/**
 * Upload a file to a tenant-scoped storage bucket and return a signed URL.
 * 
 * All storage buckets are private (public=false), so we use createSignedUrl()
 * instead of getPublicUrl(). Signed URLs expire after the given TTL.
 */
export async function uploadTenantFile(bucket: string, companyId: string, folder: string, file: File, signedUrlTtlSeconds = 604800) {
  assertSafeUpload(file);
  const supabase = createClient();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `${companyId}/${folder}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false });
  if (error) throw error;
  const { data: signedData, error: signedError } = await supabase.storage.from(bucket).createSignedUrl(path, signedUrlTtlSeconds);
  if (signedError || !signedData?.signedUrl) throw signedError ?? new Error("Could not generate signed URL");
  return signedData.signedUrl;
}

/**
 * Get a fresh signed URL for an existing storage path.
 * Use this when displaying files that were previously uploaded.
 */
export async function getSignedFileUrl(bucket: string, path: string, ttlSeconds = 3600) {
  const supabase = createClient();
  // Extract the path from a full Supabase storage URL if needed
  const cleanPath = path.includes("/object/sign/") || path.includes("/object/public/")
    ? path.split(`/storage/v1/object/`).pop()?.replace(/^(sign|public)\/[^/]+\//, "") ?? path
    : path;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(cleanPath, ttlSeconds);
  if (error || !data?.signedUrl) throw error ?? new Error("Could not generate signed URL");
  return data.signedUrl;
}
