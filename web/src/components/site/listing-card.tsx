import Link from "next/link";
import { BedDouble, Bath, Maximize } from "lucide-react";
import { GlareCard } from "@/components/motion/glare-card";
import { Badge } from "@/components/ui/badge";
import { formatPrice, formatRent } from "@/lib/money";
import type { ListingCard as Listing } from "@/lib/types";
import { cn, formatBaths, STATUS_LABEL } from "@/lib/utils";
import { ListingImage } from "./listing-image";
import { SaveButton } from "./save-button";

/** A listing tile. The whole card is one link (one click from anywhere it appears). */
export function ListingCard({ listing, priority = false, size = "md", className }: { listing: Listing; priority?: boolean; size?: "md" | "lg"; className?: string }) {
  const price = listing.listingType === "rent" ? formatRent(listing.priceCents) : formatPrice(listing.priceCents);
  return (
    <GlareCard className={cn("rounded-[28px]", className)}>
      <Link
        href={`/listings/${listing.slug}`}
        data-sa-property-card={listing.id}
        className="group block overflow-hidden rounded-[28px] bg-paper shadow-sm ring-1 ring-line transition-shadow duration-500 hover:shadow-lg"
      >
        <div className={cn("relative overflow-hidden", size === "lg" ? "aspect-[4/3] sm:aspect-[16/10]" : "aspect-[4/3]")}>
          <ListingImage
            image={listing.cover}
            alt={listing.title}
            priority={priority}
            sizes={size === "lg" ? "(min-width: 1024px) 60vw, 100vw" : "(min-width: 1280px) 30vw, (min-width: 640px) 45vw, 100vw"}
            className="size-full transition-transform duration-[1200ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.045]"
          />
          <div className="absolute inset-x-0 top-0 flex items-start justify-between p-4">
            <div className="flex gap-1.5">
              {listing.status !== "active" && <Badge tone="glass">{STATUS_LABEL[listing.status]}</Badge>}
              {listing.listingType === "rent" && <Badge tone="glass">For lease</Badge>}
              {listing.isFeatured && listing.status === "active" && <Badge tone="glass">Featured</Badge>}
            </div>
            <SaveButton propertyId={listing.id} title={listing.title} />
          </div>
        </div>
        <div className="flex flex-col gap-1 p-5 sm:p-6">
          <p className="type-eyebrow text-ink-3">
            {listing.city}, {listing.state}
          </p>
          <h3 className={cn(size === "lg" ? "type-title" : "type-headline", "text-ink")}>{listing.title}</h3>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="tabular text-lg font-medium text-ink">{price}</p>
            <ul className="flex items-center gap-3.5 text-[0.8125rem] text-ink-2">
              <li className="flex items-center gap-1" aria-label={`${listing.bedrooms} bedrooms`}>
                <BedDouble className="size-3.5" aria-hidden /> {listing.bedrooms}
              </li>
              <li className="flex items-center gap-1" aria-label={`${formatBaths(listing.fullBaths, listing.halfBaths)} bathrooms`}>
                <Bath className="size-3.5" aria-hidden /> {formatBaths(listing.fullBaths, listing.halfBaths)}
              </li>
              {listing.livingAreaSqft && (
                <li className="flex items-center gap-1" aria-label={`${listing.livingAreaSqft} square feet`}>
                  <Maximize className="size-3.5" aria-hidden /> {listing.livingAreaSqft.toLocaleString("en-US")}
                </li>
              )}
            </ul>
          </div>
        </div>
      </Link>
    </GlareCard>
  );
}
