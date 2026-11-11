import Link from "next/link";

/**
 * "Inside the homes": photographs in simple boxes with a short caption, scrolled past like any page.
 * Each box opens the matching home-style collection (lib/home-styles) on /listings.
 */
const SCENES = [
  { src: "/media/brand/scenes/lake-view", alt: "Still lake at dawn with autumn trees on the far shore", eyebrow: "The Belgrade Lakes", text: "Mornings that start at the water.", style: "waterfront" },
  { src: "/media/brand/scenes/sunroom", alt: "Sunroom with floor-to-ceiling windows and a wood ceiling", eyebrow: "Built around the view", text: "Rooms that let the outside in.", style: "waterfront" },
  { src: "/media/brand/scenes/camp", alt: "A small camp on the shore of a quiet lake below wooded hills", eyebrow: "Camps & cottages", text: "Summers at camp, year after year.", style: "camps-cottages" },
  { src: "/media/brand/scenes/cabin", alt: "Log cabin among trees", eyebrow: "Cabin in the woods", text: "A woodstove, a porch and nothing but trees.", style: "cabin-woods" },
  { src: "/media/brand/scenes/outdoor", alt: "Red Adirondack chairs on a lawn at the water's edge", eyebrow: "Outdoor oasis", text: "Evenings spent outside, by the water or the fire.", style: "outdoor-oasis" },
  { src: "/media/brand/scenes/farm", alt: "Red barns and a farmhouse on open fields", eyebrow: "Farmhouse & land", text: "Room to spread out, from gardens to pasture.", style: "farm-land" },
  { src: "/media/brand/scenes/library", alt: "Warm wood-paneled kitchen with open shelves", eyebrow: "Historic homes", text: "Original character, carefully kept.", style: "historic" },
  { src: "/media/brand/scenes/dining", alt: "Long farmhouse dining room with wide-plank floors", eyebrow: "Room for everyone", text: "Tables long enough for the whole family.", style: null },
];

export function HomeScenes() {
  return (
    <section aria-labelledby="scenes-heading" className="mx-auto max-w-[1400px] px-5 py-24 sm:px-8">
      <h2 id="scenes-heading" className="type-title">Inside the homes we represent</h2>
      <p className="mt-3 max-w-2xl text-ink-2">Pick the kind of place you picture yourself in, and we&rsquo;ll show you the homes that fit.</p>
      <ul className="mt-10 grid gap-6 sm:grid-cols-2">
        {SCENES.map((scene) => (
          <li key={scene.src} className="overflow-hidden rounded-[24px] bg-paper ring-1 ring-line">
            <Link href={scene.style ? `/listings?style=${scene.style}` : "/listings?minBeds=4"} className="group block focus-visible:outline-none">
              {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP renditions */}
              <img
                src={`${scene.src}-sm.webp`}
                srcSet={`${scene.src}-sm.webp 960w, ${scene.src}.webp 2000w`}
                sizes="(min-width: 640px) 50vw, 100vw"
                alt={scene.alt}
                loading="lazy"
                decoding="async"
                className="aspect-[3/2] w-full object-cover"
              />
              <div className="p-6">
                <p className="type-eyebrow text-brand">{scene.eyebrow}</p>
                <p className="type-headline mt-2">{scene.text}</p>
                <p className="mt-4 text-sm font-medium underline-offset-4 group-hover:underline group-focus-visible:underline">See these homes →</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
