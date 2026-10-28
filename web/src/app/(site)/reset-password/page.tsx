import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/site/account-recovery";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

export default function Page() {
  return (
    <div data-tone="ivory" className="mx-auto flex min-h-[80svh] max-w-md flex-col justify-center px-5 pb-20 pt-32">
      <p className="type-eyebrow text-brand">Your Surette account</p>
      <h1 className="type-title mb-8 mt-3">Choose a new password</h1>
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
