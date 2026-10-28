"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { useStaff } from "@/components/admin/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiClientError } from "@/lib/client-api";

interface Project { key: string; name: string; data_class: string; allowed_origins: string[]; retention_days: number; enabled_categories: string[]; events: number; last_event_at: string | null }
interface Audit { id: number; action: string; entityType: string; entityId: string | null; actor: string | null; createdAt: string }
const CATEGORIES = ["navigation", "engagement", "discovery", "conversion"] as const;

/** Owner settings: tracking projects & install snippet, retention, market data, AI status, audit log. */
export default function SettingsPage() {
  const viewer = useStaff();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [origins, setOrigins] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const appOrigin = typeof window !== "undefined" ? window.location.origin : "https://YOUR-APP";

  const load = useCallback(async () => {
    const [p, a] = await Promise.all([api<{ projects: Project[] }>("/api/analytics/projects"), api<{ entries: Audit[] }>("/api/admin/audit")]);
    setProjects(p.projects);
    setOrigins(Object.fromEntries(p.projects.map((x) => [x.key, x.allowed_origins.join(", ")])));
    setAudit(a.entries);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    if (viewer.role === "admin") void load();
  }, [load, viewer.role]);

  async function save(key: string, body: Record<string, unknown>) {
    setMessage("");
    try {
      await api("/api/analytics/projects", { method: "PATCH", body: { key, ...body } });
      setMessage("Saved.");
      await load();
    } catch (e) {
      setMessage(e instanceof ApiClientError ? `${e.message} ${Object.values(e.fields).join(" ")}` : "Couldn't save.");
    }
  }
  async function run(label: string, path: string) {
    setBusy(label);
    setMessage("");
    try {
      const r = await api<Record<string, unknown>>(path, { method: "POST" });
      setMessage(label === "market" ? `Market data: ${r.ok} FRED series refreshed, ${r.failed} unavailable.${r.govQueued ? " Government datasets queued for refresh." : ""}` : `Removed ${r.removed} expired analytics events.`);
    } catch (e) {
      setMessage(e instanceof ApiClientError ? e.message : "Failed.");
    } finally {
      setBusy("");
    }
  }

  if (viewer.role !== "admin") return <p className="text-ink-2">Settings are available to the owner and administrators.</p>;
  if (!projects) return <Skeleton className="h-96 w-full rounded-[28px]" />;
  const site = projects.find((p) => p.key === "nexus-site");
  const snippet = `<script async src="${appOrigin}/sdk/surette-analytics.js"\n        data-project="nexus-site"\n        data-endpoint="${appOrigin}/api/analytics/collect"\n        data-consent-mode="opt-in"></script>`;

  return (
    <div className="space-y-8">
      <h1 className="type-title">Settings</h1>
      {message && <p className="rounded-2xl bg-fill p-3 text-sm" role="status">{message}</p>}

      <section className="rounded-[24px] bg-paper p-6 ring-1 ring-line">
        <h2 className="type-headline">Website tracking</h2>
        <p className="mt-2 text-sm text-ink-2">
          Analytics runs on this Surette Nexus website (project <code className="rounded bg-fill px-1.5 text-[0.75rem]">nexus-site</code>). The tracker loads on every public page automatically and sends nothing until a visitor
          chooses &ldquo;Allow&rdquo; in the consent banner. Global Privacy Control and Do Not Track are honoured.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          Status: {site?.last_event_at ? <Badge tone="success">receiving · last event {new Date(site.last_event_at).toLocaleString("en-US")}</Badge> : <Badge tone="warn">waiting for the first consented visit</Badge>}
          {site && <span className="text-ink-2">{site.events.toLocaleString("en-US")} events stored</span>}
        </div>
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-ink-2">Track another page or domain (optional)</summary>
          <p className="mt-2 text-ink-2">Add this tag to the page, then add that page&rsquo;s origin to the allowed origins of <code>nexus-site</code> below.</p>
          <pre className="mt-3 overflow-x-auto rounded-2xl bg-[#15130f] p-4 text-[0.8125rem] text-[#f3efe7]">{snippet}</pre>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => void navigator.clipboard.writeText(snippet)}><Copy /> Copy tag</Button>
        </details>
        <p className="mt-3 text-[0.75rem] text-ink-3">When you deploy, add the public address (for example https://nexus.surette-realestate.com) to the allowed origins of <code>nexus-site</code>.</p>
      </section>

      <section className="rounded-[24px] bg-paper p-6 ring-1 ring-line">
        <h2 className="type-headline">Tracking projects</h2>
        <div className="mt-4 space-y-4">
          {projects.map((p) => (
            <div key={p.key} className="rounded-2xl ring-1 ring-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{p.name} <code className="ml-1 rounded bg-fill px-1.5 text-[0.75rem]">{p.key}</code></p>
                <Badge tone={p.data_class === "production" ? "success" : "warn"}>{p.data_class}</Badge>
              </div>
              <p className="mt-1 text-[0.8125rem] text-ink-2">{p.events.toLocaleString("en-US")} events stored{p.last_event_at ? ` · last ${new Date(p.last_event_at).toLocaleString("en-US")}` : ""}</p>
              <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
                <label className="text-[0.8125rem] text-ink-2">Allowed website origins (comma-separated)
                  <Input value={origins[p.key] ?? ""} onChange={(e) => setOrigins({ ...origins, [p.key]: e.target.value })} className="mt-1 h-10" />
                </label>
                <Button size="sm" className="self-end" onClick={() => void save(p.key, { allowedOrigins: (origins[p.key] ?? "").split(",").map((o) => o.trim()).filter(Boolean) })}>Save origins</Button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-[0.8125rem]">
                <label className="flex items-center gap-2">Retention
                  <select value={p.retention_days} onChange={(e) => void save(p.key, { retentionDays: Number(e.target.value) })} className="rounded-lg border border-line bg-transparent px-2 py-1">
                    {[30, 90, 180, 395, 730].map((d) => <option key={d} value={d}>{d} days</option>)}
                  </select>
                </label>
                <span className="text-ink-3">Collect:</span>
                {CATEGORIES.map((c) => (
                  <label key={c} className="flex items-center gap-1.5 capitalize"><input type="checkbox" checked={p.enabled_categories.includes(c)} onChange={(e) => void save(p.key, { enabledCategories: e.target.checked ? [...p.enabled_categories, c] : p.enabled_categories.filter((x) => x !== c) })} className="accent-[var(--brand)]" />{c}</label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <Button size="sm" variant="outline" className="mt-4" disabled={busy === "purge"} onClick={() => void run("purge", "/api/analytics/purge")}>Apply retention now</Button>
      </section>

      <section className="rounded-[24px] bg-paper p-6 ring-1 ring-line">
        <h2 className="type-headline">Market data</h2>
        <p className="mt-2 text-sm text-ink-2">FRED series refresh daily. Government datasets (Census ACS and Building Permits, BLS unemployment, FHFA price indexes) are downloaded straight from the agencies — no keys needed — and refreshed monthly by the worker; &ldquo;Refresh now&rdquo; queues one immediately. Provenance: <a className="underline" href="/api/market/datasets">/api/market/datasets</a>.</p>
        <Button size="sm" variant="outline" className="mt-3" disabled={busy === "market"} onClick={() => void run("market", "/api/market/refresh")}><RefreshCw /> {busy === "market" ? "Refreshing…" : "Refresh now"}</Button>
      </section>

      <section className="rounded-[24px] bg-paper p-6 ring-1 ring-line">
        <h2 className="type-headline">Audit log</h2>
        <ol className="mt-3 max-h-96 space-y-1 overflow-y-auto text-[0.8125rem]">
          {audit.map((a) => <li key={a.id} className="flex gap-3"><span className="w-40 shrink-0 text-ink-3">{new Date(a.createdAt).toLocaleString("en-US")}</span><span><span className="font-medium">{a.actor ?? "System"}</span> · {a.action} · {a.entityType}{a.entityId ? ` ${a.entityId.slice(0, 8)}` : ""}</span></li>)}
        </ol>
      </section>
    </div>
  );
}
