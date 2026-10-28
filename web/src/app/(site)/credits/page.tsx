import type { Metadata } from "next";
import credits from "@/content/credits.json";

export const metadata: Metadata = { title: "Photo & film credits" };

/** Attribution for every freely licensed photo and film used on the site and in demo listings. */
export default function CreditsPage() {
  return (
    <div data-tone="paper" className="mx-auto max-w-4xl px-5 pb-32 pt-32 sm:px-8">
      <p className="type-eyebrow text-brand">Credits</p>
      <h1 className="type-display mt-3">Photography &amp; film</h1>
      <p className="mt-6 text-ink-2">
        Brand imagery and demo-listing photos are licensed under Creative Commons or are in the public domain, via Wikimedia Commons. Demo listings use
        illustrative photography and fictional addresses.
      </p>
      <ul className="mt-12 divide-y divide-line border-y border-line">
        {credits.map((c) => (
          <li key={c.use} className="grid gap-1 py-4 text-sm sm:grid-cols-[180px_1fr]">
            <span className="text-ink-3">{c.use}</span>
            <span>
              <a href={c.source} className="underline underline-offset-4" rel="noreferrer" target="_blank">{c.title}</a> — {c.author} · {c.license}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
