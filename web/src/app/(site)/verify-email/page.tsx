import type { Metadata } from "next";
import { Suspense } from "react";
import { VerifyEmail } from "@/components/site/account-recovery";

export const metadata: Metadata = { title: "Confirm your email", robots: { index: false } };

export default function Page() {
  return (
    <div data-tone="ivory" className="mx-auto flex min-h-[80svh] max-w-md flex-col justify-center px-5 pb-20 pt-32">
      <p className="type-eyebrow text-gold">Your Surette account</p>
      <h1 className="type-title mb-8 mt-3">Confirm your email</h1>
      <Suspense>
        <VerifyEmail />
      </Suspense>
    </div>
  );
}
