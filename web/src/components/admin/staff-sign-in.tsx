"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { api, ApiClientError } from "@/lib/client-api";

/** Property-management sign-in (owners, admins and agents). Customer accounts are turned away here. */
export function StaffSignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage("");
    try {
      await api("/api/auth/login", { method: "POST", body: { email, password, audience: "staff" } });
      const next = params.get("next");
      router.replace(next && next.startsWith("/admin") ? next : "/admin");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrors(err.fields);
        setMessage(err.message);
      } else setMessage("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Work email" htmlFor="s-email" error={errors.email}>
        <Input id="s-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required aria-invalid={Boolean(errors.email)} />
      </Field>
      <Field label="Password" htmlFor="s-password" error={errors.password}>
        <Input id="s-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required aria-invalid={Boolean(errors.password)} />
      </Field>
      {message && (
        <p className="text-sm text-danger" role="alert">
          {message} {errors.email?.includes("/sign-in") && !errors.email.includes("portal") && <Link href="/sign-in" className="underline">Customer sign-in →</Link>}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={busy || !email || !password}>
        {busy ? "Signing in…" : "Sign in to the portal"}
      </Button>
      <p className="text-[0.8125rem] text-ink-3">
        Accounts are created by the owner in Portal → Team. Forgot your password? Ask the owner to reset it.
      </p>
    </form>
  );
}
