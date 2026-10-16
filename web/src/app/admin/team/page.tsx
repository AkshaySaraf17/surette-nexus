"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useStaff } from "@/components/admin/admin-shell";
import { AgentPortrait } from "@/components/site/agent-portrait";
import { AccountsManager } from "@/components/admin/accounts-manager";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api, ApiClientError } from "@/lib/client-api";
import type { AgentCard } from "@/lib/types";

/** The public team directory is driven from here: admins add agents (who can then sign in to the portal and app). */
export default function TeamAdminPage() {
  const viewer = useStaff();
  const [members, setMembers] = useState<AgentCard[]>([]);
  const [form, setForm] = useState({ fullName: "", email: "", title: "", bio: "", phone: "", specialties: "", role: "agent", password: "", isPublic: true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");

  useEffect(() => {
    api<{ members: AgentCard[] }>("/api/team").then(({ members }) => setMembers(members));
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setMessage("");
    try {
      const { members } = await api<{ members: AgentCard[] }>("/api/team", {
        method: "POST",
        body: {
          fullName: form.fullName,
          email: form.email,
          title: form.title,
          bio: form.bio || null,
          phone: form.phone || null,
          specialties: form.specialties.split(",").map((s) => s.trim()).filter(Boolean),
          role: form.role,
          isPublic: form.isPublic,
          password: form.password,
        },
      });
      setMembers(members);
      setMessage(`${form.fullName} was added. Share their starting password privately; they can sign in right away.`);
      setForm({ fullName: "", email: "", title: "", bio: "", phone: "", specialties: "", role: "agent", password: "", isPublic: true });
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrors(err.fields);
        setMessage(err.message);
      }
    }
  }

  return (
    <div className="space-y-10">
    {viewer.role === "admin" && <AccountsManager selfId={viewer.id} />}
    <div className="grid gap-10 lg:grid-cols-12">
      <div className="lg:col-span-7">
        <h1 className="type-title">Team</h1>
        <p className="mt-1 text-ink-2">Shown on the public Team page in this order (leader first).</p>
        <ul className="mt-8 space-y-3">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-4 rounded-[20px] bg-paper p-4 ring-1 ring-line">
              <AgentPortrait agent={m} className="size-14 shrink-0 rounded-2xl [&>span]:text-lg" />
              <div>
                <p className="font-medium">{m.fullName} {m.isLeader && <span className="text-gold">· Leader</span>}</p>
                <p className="text-sm text-ink-2">{m.title} · {m.email}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
      {viewer.role === "admin" ? (
        <form onSubmit={submit} className="space-y-4 self-start rounded-[28px] bg-paper p-6 ring-1 ring-line lg:col-span-5" noValidate>
          <h2 className="type-headline">Add a team member</h2>
          <Field label="Full name" htmlFor="t-name" error={errors.fullName}><Input id="t-name" value={form.fullName} onChange={set("fullName")} /></Field>
          <Field label="Title" htmlFor="t-title" error={errors.title}><Input id="t-title" value={form.title} onChange={set("title")} placeholder="Associate Broker" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email" htmlFor="t-email" error={errors.email}><Input id="t-email" type="email" value={form.email} onChange={set("email")} /></Field>
            <Field label="Phone" htmlFor="t-phone" error={errors.phone}><Input id="t-phone" type="tel" value={form.phone} onChange={set("phone")} /></Field>
          </div>
          <Field label="Bio" htmlFor="t-bio" error={errors.bio}><Textarea id="t-bio" value={form.bio} onChange={set("bio")} rows={4} /></Field>
          <Field label="Specialties" htmlFor="t-spec" hint="Comma-separated."><Input id="t-spec" value={form.specialties} onChange={set("specialties")} placeholder="Waterfront, First-time buyers" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Access" htmlFor="t-role"><Select id="t-role" value={form.role} onChange={set("role")}><option value="agent">Agent</option><option value="admin">Admin</option></Select></Field>
            <Field label="Starting password" htmlFor="t-pass" error={errors.password}><Input id="t-pass" type="password" value={form.password} onChange={set("password")} autoComplete="new-password" /></Field>
          </div>
          <label className="flex items-center justify-between text-sm">Show on public Team page <Switch checked={form.isPublic} onCheckedChange={(v) => setForm((f) => ({ ...f, isPublic: v }))} aria-label="Show on public Team page" /></label>
          {message && <p className="text-sm text-ink-2" role="status">{message}</p>}
          <Button type="submit" className="w-full">Add member</Button>
        </form>
      ) : (
        <p className="text-sm text-ink-2 lg:col-span-5">Ask an admin to add or edit team members.</p>
      )}
    </div>
    </div>
  );
}
