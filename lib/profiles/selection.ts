export type ProfileSelectionImageState = "unavailable" | "ready";

const rasterImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export function getApprovedProfileImagePath(
  imagePath: string | null | undefined,
  drawingApprovalStatus: string | null | undefined,
  companyId: string,
) {
  if (String(drawingApprovalStatus ?? "").toLowerCase() !== "approved") return null;
  const path = String(imagePath ?? "");
  if (!path || path !== path.trim() || /^https?:\/\//i.test(path) || /[?#%\\\u0000-\u001f\u007f]/.test(path)) return null;
  const parts = path.split("/");
  if (parts[0] !== companyId || parts.some((part) => !part || part === "." || part === "..")) return null;
  return path;
}

export function isApprovedProfileImageType(contentType: string | null | undefined) {
  return rasterImageTypes.has(String(contentType ?? "").toLowerCase().split(";")[0].trim());
}
