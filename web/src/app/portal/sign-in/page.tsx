import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { StaffSignIn } from "@/components/admin/staff-sign-in";
import { Wordmark } from "@/components/site/wordmark";

export const metadata: Metadata = { title: "Property management sign-in", robots: { index: false } };

export default function PortalSignInPage() {
  return (
    <div className="grid min-h-svh bg-[#0f1a24] text-white lg:grid-cols-[1fr_520px]">
      <div className="relative hidden overflow-hidden lg:block">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand still */}
        <img src="/media/brand/two-cent-bridge.webp" alt="" className="absolute inset-0 size-full object-cover opacity-60" />
        <div className="absolute inset-0 bg-gradient-to-tr from-[#0f1a24] via-[#0f1a24]/60 to-transparent" />
        <div className="absolute bottom-14 left-12 right-12">
          <p className="type-eyebrow text-[#d9b98a]">Property management</p>
          <p className="type-display mt-4 max-w-xl">Listings, leads, deals and analytics — one workspace for the team.</p>
        </div>
      </div>
      <div className="flex items-center justify-center bg-ivory px-6 py-16 text-ink">
        <div className="w-full max-w-sm">
          <Link href="/" aria-label="Surette Real Estate home"><Wordmark /></Link>
          <h1 className="type-title mt-10">Team sign-in</h1>
          <p className="mt-2 text-sm text-ink-2">For Surette owners, administrators and agents.</p>
          <div className="mt-8">
            <Suspense>
              <StaffSignIn />
            </Suspense>
          </div>
          <p className="mt-10 border-t border-line pt-6 text-sm text-ink-2">
            Buying, selling or renting? <Link href="/sign-in" className="font-medium text-ink underline underline-offset-4">Customer sign-in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
