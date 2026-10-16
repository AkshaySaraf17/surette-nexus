"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiClientError } from "@/lib/client-api";

interface Vendor {
  id: string | null;
  name: string;
  trade: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  insurance_expiry: string | null;
  days_until_expiry: number | null;
  status: "Compliant" | "Expiring" | "Expired" | "Missing COI" | "Inactive";
}
const TONE = { Compliant: "success", Expiring: "warn", Expired: "danger", "Missing COI": "danger", Inactive: "neutral" } as const;

/**
 * Live vendor compliance from the landlord-dispatcher's background COI audit.
 * Refreshes every 60 seconds; shows a clear notice if the dispatcher is offline.
 */
export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [mock, setMock] = useState(false);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState<string>("");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await api<{ vendors: Vendor[]; mock: boolean; generatedAt: string }>("/api/vendors/compliance");
        if (!alive) return;
        setVendors(res.vendors);
        setMock(res.mock);
        setUpdated(res.generatedAt);
        setError("");
      } catch (e) {
        if (alive) setError(e instanceof ApiClientError ? e.message : "Couldn't reach the dispatcher.");
      }
    };
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div>
      <h1 className="type-title">Vendor compliance</h1>
      <p className="mt-1 text-ink-2">Certificates of insurance audited by the dispatcher. Only compliant vendors can be dispatched.</p>
      {error && <p className="mt-6 rounded-2xl bg-warn-bg p-4 text-sm text-warn" role="alert">{error} Set DISPATCHER_API_URL in web/.env and start the dispatcher.</p>}
      {mock && <p className="mt-6 rounded-2xl bg-fill p-4 text-sm text-ink-2">The dispatcher&rsquo;s database is unavailable, so it&rsquo;s showing its default vendors.</p>}
      {vendors === null && !error ? (
        <Skeleton className="mt-8 h-72" />
      ) : vendors && (
        <div className="mt-8 overflow-x-auto rounded-[24px] bg-paper ring-1 ring-line">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-line text-[0.75rem] uppercase tracking-[0.1em] text-ink-3">
              <tr><th scope="col" className="px-4 py-3 font-medium">Vendor</th><th scope="col" className="px-4 py-3 font-medium">Trade</th><th scope="col" className="px-4 py-3 font-medium">COI expires</th><th scope="col" className="px-4 py-3 font-medium">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {vendors.map((v) => (
                <tr key={`${v.id}-${v.name}`}>
                  <td className="px-4 py-3"><p className="font-medium">{v.name}</p><p className="text-ink-3">{[v.email, v.phone].filter(Boolean).join(" · ")}</p></td>
                  <td className="px-4 py-3">{v.trade}</td>
                  <td className="tabular px-4 py-3">{v.insurance_expiry ?? "—"}{v.days_until_expiry !== null && <span className="text-ink-3"> · {v.days_until_expiry >= 0 ? `${v.days_until_expiry} days left` : `${-v.days_until_expiry} days ago`}</span>}</td>
                  <td className="px-4 py-3"><Badge tone={TONE[v.status]}>{v.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          {updated && <p className="border-t border-line px-4 py-3 text-[0.75rem] text-ink-3">Audited {new Date(updated).toLocaleString("en-US")}</p>}
        </div>
      )}
    </div>
  );
}
