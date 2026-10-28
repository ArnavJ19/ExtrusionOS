import type { Metadata } from "next";
import localFont from "next/font/local";
import { Toaster } from "sonner";
import "./globals.css";

const jakarta = localFont({
  src: [
    { path: "../node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-300-normal.woff2", weight: "300", style: "normal" },
    { path: "../node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "../node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-800-normal.woff2", weight: "800", style: "normal" }
  ],
  display: "swap",
  variable: "--font-jakarta",
});

export const metadata: Metadata = {
  title: "ExtrusionOS Enterprise",
  description: "Professional aluminium extrusion SaaS for quotation accuracy, die tracking, production visibility, dispatch, and owner analytics"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={jakarta.variable} suppressHydrationWarning>
      <body>
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
