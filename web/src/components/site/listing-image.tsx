import type { ListingCard, MediaImage } from "@/lib/types";
import { cn } from "@/lib/utils";

type Picture = Pick<MediaImage, "url" | "width" | "height" | "blurDataUrl" | "variants">;

/**
 * Responsive listing photo: WebP renditions (640/1200/2400 w) via srcset, with the
 * tiny blurred placeholder painted underneath until the real image decodes.
 */
export function ListingImage({
  image,
  alt,
  sizes,
  className,
  priority = false,
}: {
  image: Picture | ListingCard["cover"];
  alt: string;
  sizes: string;
  className?: string;
  priority?: boolean;
}) {
  if (!image) {
    return <div className={cn("bg-fill", className)} role="img" aria-label={`${alt} (photo coming soon)`} />;
  }
  const srcSet = (["sm", "md", "xl"] as const)
    .map((k) => image.variants[k])
    .filter(Boolean)
    .map((v) => `${v!.url} ${v!.width}w`)
    .join(", ");
  return (
    // eslint-disable-next-line @next/next/no-img-element -- renditions are pre-optimized by the upload pipeline
    <img
      src={image.variants.md?.url ?? image.url}
      srcSet={srcSet || undefined}
      sizes={sizes}
      alt={alt}
      width={image.width}
      height={image.height}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      className={cn("object-cover", className)}
      style={image.blurDataUrl ? { backgroundImage: `url(${image.blurDataUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
    />
  );
}
