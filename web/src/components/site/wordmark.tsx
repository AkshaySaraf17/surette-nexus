import { BROKERAGE, DEMO } from "@/lib/site";

/** Surette wordmark: a serif name with a small brand rule. Inherits color. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`whitespace-nowrap ${className ?? ""}`}>
      <span className="font-serif text-[1.45rem] font-medium leading-none tracking-[0.18em]">SURETTE</span>{" "}
      {/* The space keeps the accessible text "SURETTE Real Estate" (not "SURETTEReal Estate"). */}
      <span className="ml-2 hidden align-middle text-[0.625rem] whitespace-nowrap font-semibold uppercase tracking-[0.3em] opacity-70 sm:inline">Real Estate</span>{" "}
      <span className="ml-1 hidden align-middle text-[0.625rem] whitespace-nowrap font-semibold tracking-[0.12em] opacity-70 lg:inline">at {BROKERAGE}</span>
      {DEMO && (
        <>
          {" "}
          <span className="ml-2 inline-block rounded-full border border-current px-1.5 py-0.5 align-middle text-[0.5625rem] font-semibold uppercase leading-none tracking-[0.18em]">Demo</span>
        </>
      )}
    </span>
  );
}
