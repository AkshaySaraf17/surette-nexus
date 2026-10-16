import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div data-tone="ivory" className="mx-auto max-w-2xl px-5 pb-40 pt-44 text-center">
      <p className="type-eyebrow text-gold">404</p>
      <h1 className="type-display mt-4">This home has moved on.</h1>
      <p className="type-lede mt-6 text-ink-2">The page you were looking for isn&rsquo;t here — but plenty of others are.</p>
      <Link href="/listings" className={`${buttonVariants({ size: "lg" })} mt-10`}>See available homes</Link>
    </div>
  );
}
