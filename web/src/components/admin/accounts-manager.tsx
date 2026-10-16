"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiClientError } from "@/lib/client-api";
import { cn } from "@/lib/utils";

interface User { id: string; email: string; fullName: string; role: string; isActive: boolean; isPublic: boolean; isLeader: boolean; locked: boolean; lastLoginAt: string | null; assignedAgentId: string | null }

/** Owner/admin account management for staff and customers. */
export function AccountsManager({ selfId }: { selfId: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [tab, setTab] = useState<"staff" | "client">("staff");
  const [reset, setReset] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const load = useCallback(async () => setUsers((await api<{ users: User[] }>("/api/admin/users")).users), []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
  }, [load]);

  async function patch(id: string, body: Record<string, unknown>, done = "Saved.") {
    setMessage("");
    try {
      await api(`/api/admin/users/${id}`, { method: "PATCH", body });
      setMessage(done);
      await load();
    } catch (e) {
      setMessage(e instanceof ApiClientError ? `${e.message} ${Object.values(e.fields).join(" ")}` : "Couldn't update.");
    }
  }
  const staff = users.filter((u) => u.role !== "client");
  const shown = users.filter((u) => (tab === "client" ? u.role === "client" : u.role !== "client"));

  return (
    <section className="rounded-[24px] bg-paper p-6 ring-1 ring-line">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="type-headline">Accounts</h2>
        <div className="flex rounded-full bg-fill p-1">{(["staff", "client"] as const).map((t) => <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)} className={cn("rounded-full px-3 py-1 text-[0.8125rem]", tab === t && "bg-paper shadow-sm")}>{t === "staff" ? "Team" : "Customers"}</button>)}</div>
      </div>
      {message && <p className="mt-3 text-sm text-ink-2" role="status">{message}</p>}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-[0.75rem] uppercase tracking-[0.1em] text-ink-3"><tr><th className="py-2 font-medium">Person</th><th className="py-2 font-medium">Role</th><th className="py-2 font-medium">{tab === "client" ? "Assigned agent" : "Directory"}</th><th className="py-2 font-medium">Status</th><th className="py-2 font-medium">Reset password</th></tr></thead>
          <tbody className="divide-y divide-line">
            {shown.map((u) => (
              <tr key={u.id} className={cn(!u.isActive && "opacity-60")}>
                <td className="py-2.5"><span className="font-medium">{u.fullName}</span>{u.isLeader && <Badge className="ml-2" tone="gold">Leader</Badge>}<span className="block text-ink-3">{u.email} · last sign-in {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString("en-US") : "never"}</span></td>
                <td className="py-2.5">
                  {u.role === "client" ? "Customer" : (
                    <select value={u.role} disabled={u.id === selfId} onChange={(e) => void patch(u.id, { role: e.target.value })} className="rounded-lg border border-line bg-transparent px-2 py-1" aria-label={`Role for ${u.fullName}`}>
                      <option value="admin">Owner / admin</option><option value="agent">Agent</option>
                    </select>
                  )}
                </td>
                <td className="py-2.5">
                  {u.role === "client" ? (
                    <select value={u.assignedAgentId ?? ""} onChange={(e) => void patch(u.id, { assignedAgentId: e.target.value || null })} className="rounded-lg border border-line bg-transparent px-2 py-1" aria-label={`Agent for ${u.fullName}`}>
                      <option value="">None</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
                    </select>
                  ) : (
                    <label className="flex items-center gap-2"><input type="checkbox" checked={u.isPublic} onChange={(e) => void patch(u.id, { isPublic: e.target.checked })} className="accent-[var(--gold)]" /> Public</label>
                  )}
                </td>
                <td className="py-2.5">
                  {u.locked && <Button size="sm" variant="outline" className="mr-2" onClick={() => void patch(u.id, { unlock: true }, "Unlocked.")}>Unlock</Button>}
                  {u.id !== selfId && <Button size="sm" variant={u.isActive ? "ghost" : "outline"} onClick={() => void patch(u.id, { isActive: !u.isActive }, u.isActive ? "Deactivated — they can no longer sign in." : "Reactivated.")}>{u.isActive ? "Deactivate" : "Reactivate"}</Button>}
                </td>
                <td className="py-2.5">
                  <div className="flex gap-2">
                    <Input type="password" value={reset[u.id] ?? ""} onChange={(e) => setReset({ ...reset, [u.id]: e.target.value })} placeholder="New password" className="h-8 w-40 text-[0.8125rem]" aria-label={`New password for ${u.fullName}`} autoComplete="new-password" />
                    <Button size="sm" variant="outline" disabled={!reset[u.id]} onClick={async () => { await patch(u.id, { newPassword: reset[u.id] }, "Password reset. Share it privately; they can sign in now."); setReset({ ...reset, [u.id]: "" }); }}>Set</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[0.75rem] text-ink-3">All account changes are recorded in the audit log. There is no email provider, so password resets are set here and shared privately.</p>
    </section>
  );
}
