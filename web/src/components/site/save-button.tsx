"use client";

import { Heart } from "lucide-react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useSaved } from "./saved-context";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics-client";

/** One-tap heart: saves to the client's collection (synced live with their agent). Sends guests to sign in. */
export function SaveButton({ propertyId, title, className, tone = "light" }: { propertyId: string; title: string; className?: string; tone?: "light" | "dark" }) {
  const { saved, toggle, signedIn } = useSaved();
  const router = useRouter();
  const isSaved = saved.has(propertyId);

  return (
    <button
      type="button"
      aria-pressed={isSaved}
      aria-label={isSaved ? `Remove ${title} from your collection` : `Save ${title} to your collection`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!signedIn) {
          router.push(`/sign-in?next=${encodeURIComponent(window.location.pathname)}`);
          return;
        }
        track("property_save", { property_id: propertyId, saved: !isSaved });
        void toggle(propertyId);
      }}
      className={cn(
        "pressable grid size-10 place-items-center rounded-full",
        tone === "light" ? "material text-ink" : "border border-line-strong text-ink",
        className,
      )}
    >
      <motion.span key={String(isSaved)} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", bounce: 0.5, duration: 0.4 }}>
        <Heart className={cn("size-[18px]", isSaved && "fill-[#c2410c] text-[#c2410c]")} />
      </motion.span>
    </button>
  );
}
