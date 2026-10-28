import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** shadcn/ui Input / Textarea / Select with label, hint and inline error. */
const fieldClass =
  "w-full rounded-xl border border-line-strong bg-paper px-3.5 text-[0.9375rem] text-ink placeholder:text-ink-3 transition-colors focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15 aria-invalid:border-danger aria-invalid:ring-danger/10 disabled:opacity-50";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldClass, "h-11", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(fieldClass, "min-h-28 py-3 leading-relaxed", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(fieldClass, "h-11 appearance-none bg-[length:12px] pr-9", className)} {...props} />;
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[0.8125rem] font-medium text-ink-2">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="text-[0.8125rem] text-danger">
          {error}
        </p>
      )}
      {/* The hint stays visible with an error: it often holds the way to fix it (e.g. "Use it"). */}
      {hint && <p className="text-[0.8125rem] text-ink-3">{hint}</p>}
    </div>
  );
}
