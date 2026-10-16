import type { Metadata } from "next";
import { Suspense } from "react";
import { VendorConfirm } from "@/components/site/vendor-confirm";

export const metadata: Metadata = { title: "Confirm work order", robots: { index: false } };

export default function VendorConfirmPage() {
  return (
    <div data-tone="paper" className="mx-auto max-w-xl px-5 pb-32 pt-36">
      <p className="type-eyebrow text-gold">Vendor portal</p>
      <h1 className="type-title mt-3">Confirm you&rsquo;ve received this job</h1>
      <div className="mt-10">
        <Suspense>
          <VendorConfirm />
        </Suspense>
      </div>
    </div>
  );
}
