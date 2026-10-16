import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/site/auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <div data-tone="ivory" className="grid min-h-svh lg:grid-cols-2">
      <div className="relative hidden lg:block">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand still */}
        <img src="/media/brand/kennebec-river.webp" alt="" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <p className="type-display absolute bottom-16 left-12 right-12 text-white">Save the homes you love. Your agent sees them instantly.</p>
      </div>
      <div className="flex items-center justify-center px-5 pb-16 pt-32">
        <div className="w-full max-w-md">
          <p className="type-eyebrow text-gold">Welcome</p>
          <h1 className="type-title mt-3 mb-10">Your Surette account</h1>
          <Suspense>
            <AuthForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
