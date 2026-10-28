import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-[0.12em]", {
  variants: {
    tone: {
      neutral: "bg-fill text-ink-2",
      brand: "bg-brand/15 text-brand",
      success: "bg-success-bg text-success",
      warn: "bg-warn-bg text-warn",
      danger: "bg-danger-bg text-danger",
      glass: "material text-ink",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
