import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { UserRole } from "@/types/app";
import { hasRouteAccess, isProtectedPath } from "@/lib/auth/route-permissions";
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/supabase/config";
import { checkRateLimit } from "@/lib/utils/rate-limit";

/** Rate-limited API path prefixes and their configurations */
const rateLimitedPaths: { prefix: string; limit: number; windowSeconds: number }[] = [
  { prefix: "/api/access/invites/accept", limit: 5, windowSeconds: 60 },
  { prefix: "/api/access/invites", limit: 10, windowSeconds: 60 },
  { prefix: "/api/ai/quotation-assistant", limit: 10, windowSeconds: 60 },
  { prefix: "/api/email/send", limit: 10, windowSeconds: 60 },
  { prefix: "/api/enterprise/data-exchange", limit: 5, windowSeconds: 60 },
];

function getClientIp(request: NextRequest): string {
  return request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

async function hashRateLimitIdentifier(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Rate limiting for sensitive API endpoints
  const matchedLimit = rateLimitedPaths.find((rule) => pathname.startsWith(rule.prefix));
  if (matchedLimit) {
    const ip = getClientIp(request);
    const identifier = await hashRateLimitIdentifier(`${ip}:${matchedLimit.prefix}`);
    const result = await checkRateLimit(identifier, { limit: matchedLimit.limit, windowSeconds: matchedLimit.windowSeconds });
    if (!result.allowed) {
      return NextResponse.json(
        { error: result.available ? "Too many requests. Please try again later." : "Request protection is temporarily unavailable." },
        {
          status: result.available ? 429 : 503,
          headers: {
            "Retry-After": String(Math.ceil((result.resetAt - Date.now()) / 1000)),
            "X-RateLimit-Limit": String(matchedLimit.limit),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }
  }

  // Redirect authenticated users away from guest-only routes
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        }
      }
    }
  );

  const {
    data: { user }
  } = await supabase.auth.getUser();

  // Redirect authenticated users from auth pages to dashboard
  if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  if (!user && isProtectedPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isProtectedPath(pathname)) {
    const { data: appUser } = await supabase
      .from("app_users")
      .select("role, company_id, is_active")
      .eq("id", user.id)
      .single();

    if (!appUser?.company_id || !appUser?.is_active) {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      return NextResponse.redirect(url);
    }

    if (!hasRouteAccess(pathname, appUser.role as UserRole)) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      url.searchParams.set("denied", "1");
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
