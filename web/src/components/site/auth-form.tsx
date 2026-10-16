"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { api, ApiClientError } from "@/lib/client-api";
import type { Viewer } from "@/lib/types";
import { useSaved } from "./saved-context";

/** Customer sign in / create account. Team accounts are sent to the property-management sign-in. */
export function AuthForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { refreshViewer } = useSaved();
  const [mode, setMode] = useState<"signin" | "signup">(params.get("mode") === "signup" ? "signup" : "signin");
  const [form, setForm] = useState({ fullName: "", email: "", password: "", phone: "" });
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage("");
    try {
      const body =
        mode === "signin"
          ? { email: form.email, password: form.password, audience: "customer" }
          : { fullName: form.fullName, email: form.email, password: form.password, acceptTerms, ...(form.phone && { phone: form.phone }) };
      const { user } = await api<{ user: Viewer }>(mode === "signin" ? "/api/auth/login" : "/api/auth/signup", { method: "POST", body });
      await refreshViewer();
      const next = params.get("next");
      const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
      router.replace(user.role === "client" ? safeNext ?? "/account" : "/admin");
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrors(error.fields);
        setMessage(error.message);
      } else setMessage("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-md">
      <div className="flex rounded-full bg-fill p-1 text-sm" role="tablist" aria-label="Account">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className="relative flex-1 rounded-full py-2.5 font-medium"
          >
            {mode === m && <motion.span layoutId="auth-tab" className="absolute inset-0 rounded-full bg-paper shadow-sm" transition={{ type: "spring", bounce: 0, duration: 0.4 }} />}
            <span className="relative">{m === "signin" ? "Sign in" : "Create account"}</span>
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
        <AnimatePresence initial={false}>
          {mode === "signup" && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="space-y-4 overflow-hidden">
              <Field label="Full name" htmlFor="a-name" error={errors.fullName}>
                <Input id="a-name" value={form.fullName} onChange={set("fullName")} autoComplete="name" aria-invalid={Boolean(errors.fullName)} />
              </Field>
              <Field label="Mobile (optional)" htmlFor="a-phone" error={errors.phone}>
                <Input id="a-phone" type="tel" value={form.phone} onChange={set("phone")} autoComplete="tel" aria-invalid={Boolean(errors.phone)} />
              </Field>
            </motion.div>
          )}
        </AnimatePresence>
        <Field label="Email" htmlFor="a-email" error={errors.email}>
          <Input id="a-email" type="email" value={form.email} onChange={set("email")} autoComplete="email" required aria-invalid={Boolean(errors.email)} />
        </Field>
        <Field label="Password" htmlFor="a-password" error={errors.password} hint={mode === "signup" ? "At least 10 characters, with a letter and a number." : undefined}>
          <Input id="a-password" type="password" value={form.password} onChange={set("password")} autoComplete={mode === "signin" ? "current-password" : "new-password"} required aria-invalid={Boolean(errors.password)} />
        </Field>
        {mode === "signup" && (
          <div>
            <label className="flex items-start gap-3 text-sm text-ink-2">
              <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} className="mt-1 accent-[var(--gold)]" aria-invalid={Boolean(errors.acceptTerms)} />
              <span>
                I&rsquo;ve read the <Link href="/privacy" className="underline underline-offset-4">privacy notice</Link>. Surette stores my saved homes, searches and
                scenarios so I can use them across devices, and I can delete them anytime.
              </span>
            </label>
            {errors.acceptTerms && <p className="mt-1 text-[0.8125rem] text-danger">{errors.acceptTerms}</p>}
          </div>
        )}
        {message && (
          <p className="text-sm text-danger" role="alert">
            {message}{" "}
            {errors.email?.includes("/portal/sign-in") && <Link href="/portal/sign-in" className="underline">Go to the team sign-in →</Link>}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? "One moment…" : mode === "signin" ? "Sign in" : "Create account"}
        </Button>
      </form>
      <p className="mt-6 text-center text-[0.8125rem] text-ink-3">
        Save homes, compare them, keep searches and Dual-Move plans, and share collections live with your agent.
        Property-management team? <Link href="/portal/sign-in" className="underline underline-offset-4">Team sign-in</Link>.
      </p>
    </div>
  );
}
