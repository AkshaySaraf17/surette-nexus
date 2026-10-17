"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { api, ApiClientError } from "@/lib/client-api";
import { useSaved } from "./saved-context";

/** "Forgot password?" — asks for the email and always shows the same confirmation. */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState("sending");
    setError("");
    setFieldError("");
    try {
      await api("/api/auth/password/forgot", { method: "POST", body: { email } });
      setState("sent");
    } catch (err) {
      setState("idle");
      if (err instanceof ApiClientError) {
        setError(err.message);
        setFieldError(err.fields.email ?? "");
      } else setError("Something went wrong. Please try again.");
    }
  }

  if (state === "sent") {
    return (
      <div className="space-y-4" role="status">
        <p className="text-ink-2">
          If an account exists for <strong className="text-ink">{email}</strong>, we&rsquo;ve emailed a link to choose a new password. It works once, for 1 hour.
        </p>
        <p className="text-sm text-ink-3">Nothing arrived? Check spam, or try again in a few minutes.</p>
        <Link href="/sign-in" className="inline-block text-sm underline underline-offset-4">Back to sign in</Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Email" htmlFor="f-email" error={fieldError}>
        <Input id="f-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required aria-invalid={Boolean(fieldError)} />
      </Field>
      {error && !fieldError && <p className="text-sm text-danger" role="alert">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={state === "sending" || !email}>{state === "sending" ? "Sending…" : "Email me a reset link"}</Button>
      <p className="text-center text-sm"><Link href="/sign-in" className="underline underline-offset-4">Back to sign in</Link></p>
    </form>
  );
}

/** Reset link target: choose a new password. */
export function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const { refreshViewer } = useSaved();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setMessage("");
    if (password !== confirm) return setErrors({ confirm: "The two passwords don't match." });
    setBusy(true);
    try {
      await api("/api/auth/password/reset", { method: "POST", body: { token, password } });
      await refreshViewer();
      router.replace("/account?reset=1");
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

  if (!token) {
    return (
      <p className="text-ink-2">
        This page needs the link from your reset email. <Link href="/forgot-password" className="underline underline-offset-4">Request a new link</Link>.
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="New password" htmlFor="r-password" error={errors.password} hint="At least 10 characters, with a letter and a number.">
        <Input id="r-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required aria-invalid={Boolean(errors.password)} />
      </Field>
      <Field label="Confirm new password" htmlFor="r-confirm" error={errors.confirm}>
        <Input id="r-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required aria-invalid={Boolean(errors.confirm)} />
      </Field>
      {message && (
        <p className="text-sm text-danger" role="alert">
          {message} {message.includes("Request a new one") && <Link href="/forgot-password" className="underline underline-offset-4">Request a new link</Link>}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={busy || !password || !confirm}>{busy ? "Saving…" : "Save new password"}</Button>
      <p className="text-[0.8125rem] text-ink-3">Saving signs you out on every other device.</p>
    </form>
  );
}

/** Verification link target: confirms the email as soon as the page opens. */
export function VerifyEmail() {
  const params = useSearchParams();
  const { refreshViewer } = useSaved();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<"working" | "done" | "failed">(token ? "working" : "failed");
  const [message, setMessage] = useState(token ? "" : "This page needs the link from your confirmation email.");
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api("/api/auth/verify", { method: "POST", body: { token } })
      .then(async () => {
        setState("done");
        await refreshViewer().catch(() => undefined);
      })
      .catch((err) => {
        setState("failed");
        setMessage(err instanceof ApiClientError ? err.message : "Something went wrong. Please try again.");
      });
  }, [token, refreshViewer]);

  if (state === "working") return <p className="text-ink-2" role="status">Confirming your email…</p>;
  if (state === "done") {
    return (
      <div className="space-y-4" role="status">
        <p className="text-ink-2">Your email is confirmed. You can now save homes, searches and plans.</p>
        <Link href="/account" className="inline-block rounded-full bg-ink px-5 py-3 text-sm font-medium text-paper">Go to your account</Link>
      </div>
    );
  }
  return (
    <div className="space-y-3" role="alert">
      <p className="text-danger">{message}</p>
      <p className="text-sm text-ink-2">Signed in? You can send a fresh link from <Link href="/account" className="underline underline-offset-4">your account page</Link>.</p>
    </div>
  );
}
