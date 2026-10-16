import Link from "next/link";
import { Parallax } from "@/components/motion/parallax";
import { Reveal } from "@/components/motion/reveal";
import { formatPrice } from "@/lib/money";
import type { ListingCard } from "@/lib/types";
import { cn, formatAcres, formatBaths } from "@/lib/utils";
import { ListingImage } from "./listing-image";
import { SaveButton } from "./save-button";

/** Editorial spreads for featured listings: a large parallax photograph beside generous whitespace. */
export function Featured({ listings }: { listings: ListingCard[] }) {
  return (
    <div className="space-y-28 sm:space-y-40">
      {listings.map((l, i) => (
        <article key={l.id} className={cn("grid items-center gap-10 lg:grid-cols-12 lg:gap-16")}>
          <Link
            href={`/listings/${l.slug}`}
            className={cn("group relative block lg:col-span-7", i % 2 === 1 && "lg:order-2 lg:col-start-6")}
            aria-label={`${l.title}, ${l.city}`}
          >
            <Parallax strength={8} className="aspect-[4/5] rounded-[32px] sm:aspect-[5/4]">
              <ListingImage image={l.cover} alt={l.title} sizes="(min-width: 1024px) 58vw, 100vw" className="size-full transition-transform duration-[1400ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03]" />
            </Parallax>
            <div className="absolute right-5 top-5">
              <SaveButton propertyId={l.id} title={l.title} />
            </div>
          </Link>
          <Reveal className={cn("lg:col-span-5", i % 2 === 1 && "lg:order-1 lg:col-start-1 lg:row-start-1")}>
            <p className="type-eyebrow text-gold">
              {String(i + 1).padStart(2, "0")} · {l.city}, Maine
            </p>
            <h3 className="type-display mt-4">{l.title}</h3>
            {l.headline && <p className="type-lede mt-5 text-ink-2">{l.headline}</p>}
            <dl className="mt-8 grid grid-cols-3 gap-6 border-y border-line py-6">
              <div>
                <dt className="type-eyebrow text-ink-3">Offered at</dt>
                <dd className="tabular mt-1.5 text-lg">{formatPrice(l.priceCents)}</dd>
              </div>
              <div>
                <dt className="type-eyebrow text-ink-3">Bed / Bath</dt>
                <dd className="mt-1.5 text-lg">
                  {l.bedrooms} / {formatBaths(l.fullBaths, l.halfBaths)}
                </dd>
              </div>
              <div>
                <dt className="type-eyebrow text-ink-3">{l.lotSizeSqft && l.lotSizeSqft > 43_560 ? "Land" : "Interior"}</dt>
                <dd className="mt-1.5 text-lg">
                  {l.lotSizeSqft && l.lotSizeSqft > 43_560 ? formatAcres(l.lotSizeSqft) : `${l.livingAreaSqft?.toLocaleString("en-US") ?? "—"} sq ft`}
                </dd>
              </div>
            </dl>
            <Link href={`/listings/${l.slug}`} className="group mt-8 inline-flex items-center gap-3 text-sm font-medium">
              <span className="border-b border-current pb-0.5">View the residence</span>
              <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-1">→</span>
            </Link>
          </Reveal>
        </article>
      ))}
    </div>
  );
}
