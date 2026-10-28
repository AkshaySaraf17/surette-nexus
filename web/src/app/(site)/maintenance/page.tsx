import type { Metadata } from "next";
import { MaintenanceForm } from "@/components/site/maintenance-form";

export const metadata: Metadata = { title: "Tenant maintenance request" };

export default function MaintenancePage() {
  return (
    <div data-tone="paper" className="mx-auto grid max-w-[1200px] gap-16 px-5 pb-32 pt-32 sm:px-8 lg:grid-cols-2">
      <div>
        <p className="type-eyebrow text-brand">Tenants</p>
        <h1 className="type-display mt-3">Report a maintenance issue</h1>
        <p className="type-lede mt-6 text-ink-2">
          Day or night, tell us what&rsquo;s wrong. Your request is triaged instantly, matched with an insured local contractor, and our team is notified.
        </p>
        <ol className="mt-10 space-y-5 text-ink-2">
          <li><strong className="text-ink">1 · Describe it.</strong> Plain words are fine — no forms to navigate.</li>
          <li><strong className="text-ink">2 · We triage.</strong> The trade and urgency are identified automatically.</li>
          <li><strong className="text-ink">3 · We dispatch.</strong> Only contractors with current insurance are sent.</li>
        </ol>
      </div>
      <MaintenanceForm />
    </div>
  );
}
