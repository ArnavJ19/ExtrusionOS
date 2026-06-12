type UploadFileInput = {
  name: string;
  size: number;
  type?: string;
};

type UploadValidationOptions = {
  allowedExtensions: readonly string[];
  allowedMimeTypes: readonly string[];
  maxSizeBytes: number;
  label: string;
  allowEmptyMimeType?: boolean;
};

export const technicalDrawingUploadRules: UploadValidationOptions = {
  allowedExtensions: ["pdf", "png", "jpg", "jpeg", "webp", "dwg", "dxf", "dgn", "step", "stp", "iges", "igs", "sat", "stl", "3dm"],
  allowedMimeTypes: ["application/pdf", "image/png", "image/jpeg", "image/webp"],
  maxSizeBytes: 25 * 1024 * 1024,
  label: "technical drawing",
  allowEmptyMimeType: true,
};

export const maintenanceBillUploadRules: UploadValidationOptions = {
  allowedExtensions: ["pdf", "png", "jpg", "jpeg", "webp"],
  allowedMimeTypes: ["application/pdf", "image/png", "image/jpeg", "image/webp"],
  maxSizeBytes: 10 * 1024 * 1024,
  label: "maintenance bill",
};

export function validateUploadFile(file: UploadFileInput, options: UploadValidationOptions) {
  const extension = getFileExtension(file.name);
  if (!extension || !options.allowedExtensions.includes(extension)) {
    return {
      ok: false,
      error: `${capitalize(options.label)} must be one of: ${options.allowedExtensions.map((item) => `.${item}`).join(", ")}.`,
    };
  }

  if (file.size <= 0) return { ok: false, error: `${capitalize(options.label)} cannot be empty.` };
  if (file.size > options.maxSizeBytes) return { ok: false, error: `${capitalize(options.label)} must be ${formatBytes(options.maxSizeBytes)} or smaller.` };

  const mimeType = file.type?.toLowerCase() ?? "";
  const mimeAllowed = options.allowedMimeTypes.includes(mimeType);
  const emptyMimeAllowed = options.allowEmptyMimeType && !mimeType;
  const cadExtension = isCadExtension(extension);
  if (!mimeAllowed && !emptyMimeAllowed && !cadExtension) {
    return { ok: false, error: `${capitalize(options.label)} file type is not allowed.` };
  }

  return { ok: true, error: null };
}

export function getFileExtension(fileName: string) {
  const lastSegment = fileName.trim().toLowerCase().split(/[\\/]/).pop() ?? "";
  const extension = lastSegment.includes(".") ? lastSegment.split(".").pop() ?? "" : "";
  return extension.replace(/[^a-z0-9]/g, "");
}

function isCadExtension(extension: string) {
  return ["dwg", "dxf", "dgn", "step", "stp", "iges", "igs", "sat", "stl", "3dm"].includes(extension);
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatBytes(bytes: number) {
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}
