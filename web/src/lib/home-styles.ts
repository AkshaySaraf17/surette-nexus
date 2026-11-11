/**
 * Home-style collections ("Camps & cottages", "Cabin in the woods"...). Each one is a keyword
 * search over a listing's title, headline, description and amenities, so new listings join a
 * collection by how they're described, with no extra tagging. Used by the home page cards, the
 * /listings "Home style" filter and the AI assistant.
 */
export interface HomeStyle {
  slug: string;
  label: string;
  /** Postgres to_tsquery terms (English stemming), OR-ed. */
  terms: string[];
}

export const HOME_STYLES: HomeStyle[] = [
  { slug: "camps-cottages", label: "Camps & cottages", terms: ["camp", "cottage", "bungalow", "bunkhouse"] },
  { slug: "cabin-woods", label: "Cabin in the woods", terms: ["cabin", "woods", "wooded", "forest", "log"] },
  { slug: "waterfront", label: "On the water", terms: ["waterfront", "frontage", "dock", "lake", "pond", "river", "shoreline"] },
  { slug: "outdoor-oasis", label: "Outdoor oasis", terms: ["garden", "patio", "terrace", "deck", "screened <-> porch", "wraparound <-> porch", "fire <-> pit", "orchard"] },
  { slug: "farm-land", label: "Farmhouse & land", terms: ["farm", "farmhouse", "bank <-> barn", "acre", "acreage", "pasture", "horse"] },
  { slug: "historic", label: "Historic character", terms: ["historic", "original", "victorian", "colonial", "italianate", "federal", "millwork"] },
  { slug: "in-town", label: "Walk to town", terms: ["downtown", "walk <-> to", "main <-> street", "riverwalk"] },
];

export function homeStyle(slug: string | null | undefined): HomeStyle | undefined {
  return HOME_STYLES.find((s) => s.slug === slug);
}

/** The to_tsquery string for a style, e.g. "(camp) | (cottage) | (seasonal)". */
export function styleTsQuery(style: HomeStyle): string {
  return style.terms.map((t) => `(${t})`).join(" | ");
}
