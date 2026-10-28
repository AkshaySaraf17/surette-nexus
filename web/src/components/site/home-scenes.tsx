/** "Inside the homes": four photographs in simple boxes with a short caption, scrolled past like any page. */
const SCENES = [
  { src: "/media/brand/scenes/lake-view", alt: "Still lake at dawn with autumn trees on the far shore", eyebrow: "The Belgrade Lakes", text: "Mornings that start at the water." },
  { src: "/media/brand/scenes/sunroom", alt: "Sunroom with floor-to-ceiling windows and a wood ceiling", eyebrow: "Built around the view", text: "Rooms that let the outside in." },
  { src: "/media/brand/scenes/library", alt: "Warm wood-paneled kitchen with open shelves", eyebrow: "Historic homes", text: "Original character, carefully kept." },
  { src: "/media/brand/scenes/dining", alt: "Long farmhouse dining room with wide-plank floors", eyebrow: "Room for everyone", text: "Tables long enough for the whole family." },
];

export function HomeScenes() {
  return (
    <section aria-labelledby="scenes-heading" className="mx-auto max-w-[1400px] px-5 py-24 sm:px-8">
      <h2 id="scenes-heading" className="type-title">Inside the homes we represent</h2>
      <ul className="mt-10 grid gap-6 sm:grid-cols-2">
        {SCENES.map((scene) => (
          <li key={scene.src} className="overflow-hidden rounded-[24px] bg-paper ring-1 ring-line">
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
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
