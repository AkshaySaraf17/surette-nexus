/**
 * Money helpers. Every amount in Surette Nexus is an integer number of cents
 * ($410.67 → 41067). These are the only places dollars and cents convert, and
 * parsing never passes through a floating-point number.
 */

/** "1,250,000" or "$410.67" → 125000000 / 41067. Null for anything that isn't a valid non-negative amount. */
export function dollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/[$,\s]/g, "");
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** 41067 → "$410.67" */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/** 125000000 → "$1,250,000" (whole dollars, for list prices). Rounds half-up on the cents. */
export function formatPrice(cents: number): string {
  const dollars = Math.floor((cents + 50) / 100);
  return `$${dollars.toLocaleString("en-US")}`;
}

/** 125000000 → "$1.25M", 89500000 → "$895K" (compact map pins). */
export function formatPriceCompact(cents: number): string {
  const dollars = Math.floor(cents / 100);
  if (dollars >= 1_000_000) {
    const tenths = Math.floor(dollars / 10_000); // hundredths of a million
    const whole = Math.floor(tenths / 100);
    const frac = String(tenths % 100).padStart(2, "0").replace(/0+$/, "");
    return `$${whole}${frac ? `.${frac}` : ""}M`;
  }
  if (dollars >= 1_000) return `$${Math.floor(dollars / 1_000)}K`;
  return `$${dollars}`;
}

/** Monthly rent display for rental listings. */
export function formatRent(cents: number): string {
  return `${formatPrice(cents)}/mo`;
}
