import { Reveal } from "@/components/motion/reveal-animated";

/**
 * "Inside the homes" — full-screen photographs that stack as you scroll. Each panel is
 * `position: sticky`, so the next one slides up over it using the browser's native
 * scrolling: no frame scrubbing, no JavaScript per frame, nothing to stutter.
 */
const SCENES = [
  { src: "/media/brand/scenes/lake-view", alt: "Still lake at dawn with autumn trees on the far shore", eyebrow: "The Belgrade Lakes", text: "Mornings that start at the water." },
  { src: "/media/brand/scenes/sunroom", alt: "Sunroom with floor-to-ceiling windows and a wood ceiling", eyebrow: "Built around the view", text: "Rooms that let the outside in." },
  { src: "/media/brand/scenes/library", alt: "Warm wood-paneled kitchen with open shelves", eyebrow: "Historic homes", text: "Original character, carefully kept." },
  { src: "/media/brand/scenes/dining", alt: "Long farmhouse dining room with wide-plank floors", eyebrow: "Room for everyone", text: "Tables long enough for the whole family." },
];

export function ScrollScenes() {
  return (
    <section data-tone="pine" aria-label="Inside the homes we represent" className="relative bg-[#1f3a32]">
      {SCENES.map((scene, i) => (
        <div key={scene.src} className="sticky top-0 h-svh overflow-hidden" style={{ zIndex: i + 1 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP renditions */}
          <img
            src={`${scene.src}.webp`}
            srcSet={`${scene.src}-sm.webp 960w, ${scene.src}.webp 2000w`}
            sizes="100vw"
            alt={scene.alt}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-black/20" aria-hidden />
          <div className="absolute inset-x-0 bottom-[12%] px-6 text-center text-white">
            <Reveal>
              <p className="type-eyebrow text-white/75">{scene.eyebrow}</p>
              <p className="type-display mx-auto mt-3 max-w-3xl [text-shadow:0_2px_30px_rgb(0_0_0/0.35)]">{scene.text}</p>
            </Reveal>
          </div>
        </div>
      ))}
    </section>
  );
}
