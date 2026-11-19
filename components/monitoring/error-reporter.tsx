"use client";

// FS-07: reports uncaught browser errors and unhandled promise rejections on signed-in screens.
import { useEffect } from "react";
import { reportBrowserError } from "@/lib/monitoring/report";

export function ErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => { void reportBrowserError(event.error ?? event.message, window.location.pathname); };
    const onRejection = (event: PromiseRejectionEvent) => { void reportBrowserError(event.reason, window.location.pathname); };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); };
  }, []);
  return null;
}
