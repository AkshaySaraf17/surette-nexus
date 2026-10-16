import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** shadcn/ui Button, restyled for Surette Nexus. Press feedback is instant (on pointer-down). */
export const buttonVariants = cva(
  "pressable inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-ink text-paper hover:bg-ink/85",
        gold: "bg-gold text-white hover:brightness-110",
        outline: "border border-line-strong bg-transparent text-ink hover:border-ink hover:bg-fill",
        ghost: "bg-transparent text-ink hover:bg-fill",
        glass: "material border border-white/25 text-white hover:bg-white/15",
        danger: "bg-danger text-white hover:brightness-110",
        link: "rounded-none px-0 text-ink underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3.5 text-[0.8125rem]",
        md: "h-11 px-5 text-sm",
        lg: "h-13 px-7 text-[0.9375rem]",
        icon: "size-10",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
