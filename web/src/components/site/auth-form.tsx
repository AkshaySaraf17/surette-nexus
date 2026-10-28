"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { api, ApiClientError } from "@/lib/client-api";
import type { Viewer } from "@/lib/types";
import { useSaved } from "./saved-context";

const GOOGLE_ERRORS: Record<string, string> = {
  google_off: "Google sign-in isn't switched on yet. Use your email and password.",
  google_cancelled: "Google sign-in was cancelled.",
  google_failed: "Google sign-in didn't complete. Please try again.",
  google_email_unverified: "Your Google account's email isn't verified, so it can't be used here.",
  google_mismatch: "This email is already linked to a different Google account.",
  wrong_portal: "That's a team account. Use the property-management sign-in.",
  account_disabled: "This account has been deactivated. Contact the office.",
};

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

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
  const [google, setGoogle] = useState(false);
  const [emailOn, setEmailOn] = useState(true);
  const googleError = GOOGLE_ERRORS[params.get("error") ?? ""];

  useEffect(() => {
    api<{ google: boolean; email: boolean }>("/api/auth/providers").then((p) => { setGoogle(p.google); setEmailOn(p.email); }).catch(() => undefined);
  }, []);
  const nextParam = params.get("next");
  const googleHref = `/api/auth/google/start${nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? `?next=${encodeURIComponent(nextParam)}` : ""}`;

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
      {googleError && <p className="mt-6 rounded-2xl bg-warn-bg p-3 text-sm text-warn" role="alert">{googleError}</p>}
      {google && (
        <>
          <a href={googleHref} className="pressable mt-8 flex h-12 w-full items-center justify-center gap-3 rounded-full border border-line-strong bg-paper font-medium hover:bg-fill">
            <GoogleMark /> Continue with Google
          </a>
          <p className="mt-2 text-center text-[0.75rem] text-ink-3">
            By continuing with Google you accept the <Link href="/privacy" className="underline underline-offset-4">privacy notice</Link>.
          </p>
          <div className="mt-6 flex items-center gap-3 text-[0.75rem] uppercase tracking-[0.14em] text-ink-3" aria-hidden>
            <span className="h-px flex-1 bg-line" /> or with email <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}
      <form onSubmit={submit} className={google ? "mt-6 space-y-4" : "mt-8 space-y-4"} noValidate>
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
        {mode === "signin" && emailOn && (
          <p className="-mt-1 text-right text-[0.8125rem]">
            <Link href="/forgot-password" className="underline underline-offset-4">Forgot password?</Link>
          </p>
        )}
        {mode === "signup" && (
          <div>
            <label className="flex items-start gap-3 text-sm text-ink-2">
              <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} className="mt-1 accent-[var(--brand)]" aria-invalid={Boolean(errors.acceptTerms)} />
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
