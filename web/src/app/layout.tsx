import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import { MotionProvider } from "@/components/motion/provider";
import { BRAND, BROKERAGE, DEMO, SITE_NAME } from "@/lib/site";
import "./globals.css";

const serif = Cormorant_Garamond({ subsets: ["latin"], weight: ["300", "400", "500", "600"], style: ["normal", "italic"], variable: "--font-cormorant", display: "swap" });
const sans = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: `${BRAND} Team at ${BROKERAGE}${DEMO ? " (Demo)" : ""} — Waterville & Central Maine`, template: `%s · ${SITE_NAME}` },
  description: "Homes, lake houses and land across Waterville and Central Maine, with live availability, private showings and a team that knows every road.",
  metadataBase: new URL(process.env.PUBLIC_SITE_URL ?? "http://localhost:3000"),
  // A demo must not show up in search results as if it were the official site.
  robots: DEMO ? { index: false, follow: false } : undefined,
  openGraph: { type: "website", siteName: SITE_NAME, images: ["/media/brand/hero/colonial.webp"] },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f4ee" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0c0a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body className="min-h-svh">
        <a href="#main" className="sr-only z-[100] rounded-full bg-ink px-4 py-2 text-paper focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
          Skip to content
        </a>
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
