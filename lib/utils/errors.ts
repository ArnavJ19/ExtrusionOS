type SupabaseLikeError = {
  code?: string;
  message?: string;
  details?: string;
};

export function getErrorMessage(error: unknown, fallback = "Something went wrong. Please try again.") {
  if (!error) return fallback;
  const candidate = error as SupabaseLikeError;
  const message = candidate.message || fallback;

  if (candidate.code === "23505" || /duplicate key/i.test(message)) return "A record with this number or code already exists.";
  if (candidate.code === "23503" || /foreign key/i.test(message)) return "One selected record is no longer available. Refresh and try again.";
  if (/row-level security/i.test(message) || /permission denied/i.test(message)) return "You do not have permission to perform this action for this company.";
  if (/invalid input syntax for type uuid/i.test(message)) return "Please select a valid record before saving.";

  return message;
}
