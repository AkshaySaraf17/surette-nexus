"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { api, ApiClientError } from "@/lib/client-api";

const EVENTS = ["listing.published", "listing.updated", "media.uploaded", "showing.requested", "showing.updated", "collection.activity"] as const;

interface Webhook {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  lastDelivery: { statusCode: number | null; error: string | null; at: string } | null;
}

/** Outbound webhooks (signed with HMAC-SHA256) for CRMs, Slack relays or the dispatcher. Admins only. */
export default function WebhooksPage() {
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setHooks((await api<{ webhooks: Webhook[] }>("/api/webhooks")).webhooks);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load webhooks.");
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const { webhook } = await api<{ webhook: { secret: string } }>("/api/webhooks", { method: "POST", body: { url, events } });
      setSecret(webhook.secret);
      setUrl("");
      setEvents([]);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.fields.url ?? err.message : "Couldn't add the webhook.");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Stop sending events to this endpoint?")) return;
    await api(`/api/webhooks/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="max-w-3xl">
      <h1 className="type-title">Webhooks</h1>
      <p className="mt-1 text-ink-2">
        Each delivery is a JSON POST with <code className="rounded bg-fill px-1">X-Surette-Signature: t=…,v1=HMAC-SHA256(secret, &quot;t.body&quot;)</code>. Failures retry three times.
      </p>
      <form onSubmit={add} className="mt-8 space-y-4 rounded-[24px] bg-paper p-6 ring-1 ring-line">
        <Field label="Endpoint URL" htmlFor="wh-url" error={error}>
          <Input id="wh-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/surette" required />
        </Field>
        <fieldset>
          <legend className="text-[0.8125rem] font-medium text-ink-2">Events (none selected = all)</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {EVENTS.map((ev) => (
              <label key={ev} className="flex items-center gap-2 rounded-full border border-line-strong px-3 py-1.5 text-[0.8125rem]">
                <input type="checkbox" checked={events.includes(ev)} onChange={(e) => setEvents((all) => (e.target.checked ? [...all, ev] : all.filter((x) => x !== ev)))} className="accent-[var(--brand)]" />
                {ev}
              </label>
            ))}
          </div>
        </fieldset>
        <Button type="submit">Add endpoint</Button>
        {secret && (
          <p className="rounded-2xl bg-warn-bg p-4 text-sm text-warn" role="status">
            Signing secret (shown once — store it now): <code className="break-all font-mono">{secret}</code>
          </p>
        )}
      </form>
      <ul className="mt-8 space-y-3">
        {hooks.map((h) => (
          <li key={h.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] bg-paper p-4 ring-1 ring-line">
            <div className="min-w-0">
              <p className="truncate font-medium">{h.url}</p>
              <p className="text-[0.8125rem] text-ink-2">{h.events.length ? h.events.join(", ") : "All events"}</p>
              <p className="text-[0.75rem] text-ink-3">
                {h.lastDelivery ? `Last delivery ${new Date(h.lastDelivery.at).toLocaleString("en-US")} · ${h.lastDelivery.error ?? `HTTP ${h.lastDelivery.statusCode}`}` : "No deliveries yet"}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => void remove(h.id)}>Remove</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
