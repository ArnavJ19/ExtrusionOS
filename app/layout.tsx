import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
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
