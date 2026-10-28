/** "Life in Central Maine": one still photograph beside a short paragraph. */
export function Seasons() {
  return (
    <section aria-labelledby="seasons-heading" className="mx-auto max-w-[1400px] px-5 py-24 sm:px-8">
      <div className="grid items-center gap-10 overflow-hidden rounded-[28px] bg-paper ring-1 ring-line lg:grid-cols-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand still */}
        <img src="/media/brand/autumn-river-poster.webp" alt="An autumn river lined with orange and red trees" loading="lazy" className="aspect-[4/3] size-full object-cover" />
        <div className="p-8 lg:p-12">
          <p className="type-eyebrow text-brand">Life in Central Maine</p>
          <h2 id="seasons-heading" className="type-title mt-3">Rivers, lakes and four honest seasons.</h2>
          <p className="type-lede mt-5 text-ink-2">From October on the water to quiet winters and long summer evenings at camp, we help you find a home that fits the way you want to live here.</p>
        </div>
      </div>
    </section>
  );
}
