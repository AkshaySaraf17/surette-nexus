import type { AgentCard } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Agent photo, or an engraved monogram when no portrait has been uploaded yet. */
export function AgentPortrait({ agent, className }: { agent: Pick<AgentCard, "fullName" | "photoUrl">; className?: string }) {
  if (agent.photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- portraits come from our own media store
    return <img src={agent.photoUrl} alt={agent.fullName} className={cn("object-cover", className)} />;
  }
  const initials = agent.fullName
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div
      role="img"
      aria-label={agent.fullName}
      className={cn("grid place-items-center bg-[radial-gradient(circle_at_30%_20%,#3a2f22,#14110c)] font-serif text-[#e9d3ad]", className)}
    >
      <span className="text-[clamp(2.5rem,6vw,5rem)] font-light tracking-[0.08em]">{initials}</span>
    </div>
  );
}
