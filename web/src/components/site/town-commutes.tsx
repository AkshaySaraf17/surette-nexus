import Link from "next/link";
import { COMMUTE_ANCHORS, TOWN_CENTERS, estimateDriveMinutes, walkIndex, walkIndexLabel } from "@/lib/geo";

const DESTINATIONS = ["downtown", "augusta", "portland"].map((id) => COMMUTE_ANCHORS.find((a) => a.id === id)!);
const SHORT: Record<string, string> = { downtown: "Waterville", augusta: "Augusta", portland: "Portland" };

/**
 * Commutes and walkability, town by town. In most of Central Maine you drive for groceries, so the
 * drive times say more than the Walk Index; both are estimates (see lib/geo).
 */
export function TownCommutes() {
  const rows = TOWN_CENTERS.map((t) => ({
    ...t,
    walkScore: t.walk === "mapped" ? walkIndex(t.position) : null,
    drives: DESTINATIONS.map((d) => estimateDriveMinutes(t.position, d.position)),
  }));
  return (
    <section className="rounded-[28px] bg-paper p-6 ring-1 ring-line" aria-labelledby="commute-h">
      <p className="type-eyebrow text-brand">Commutes &amp; walkability</p>
      <h2 id="commute-h" className="type-headline mt-1">How far is everything, town by town?</h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-2">
        Many buyers are moving out of the cities for more affordable homes, so the drive matters. Outside downtown Waterville and Winslow, most of the area is car country: expect to drive for groceries, and use these times to compare towns.
      </p>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <caption className="sr-only">Estimated drive times and Walk Index from each town center</caption>
          <thead className="text-[0.75rem] uppercase tracking-[0.1em] text-ink-3">
            <tr className="border-b border-line">
              <th scope="col" className="py-2 pr-4 font-medium">Town center</th>
              {DESTINATIONS.map((d) => <th key={d.id} scope="col" className="py-2 pr-4 font-medium">To {SHORT[d.id]}</th>)}
              <th scope="col" className="py-2 font-medium">Walkability</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.town} className="border-b border-line/60">
                <th scope="row" className="py-2.5 pr-4 font-medium">{r.town}</th>
                {r.drives.map((m, i) => <td key={DESTINATIONS[i].id} className="tabular py-2.5 pr-4">{m < 60 ? `~${m} min` : `~${Math.floor(m / 60)} h ${m % 60} min`}</td>)}
                <td className="py-2.5 text-ink-2">{r.walkScore !== null ? `${r.walkScore} · ${walkIndexLabel(r.walkScore)}` : <span className="text-ink-3">{r.walk === "rural" ? "Rural: plan to drive" : "Not scored yet"}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[0.75rem] text-ink-3">
        Drive times are estimates from distance and typical road speeds, not live traffic. Walk Index is our own 0–100 estimate of shops, parks and services within walking distance of the town center, not a Walk Score® rating; individual homes vary.{" "}
        <Link href={"/listings?driveTo=augusta&maxDrive=30"} className="underline underline-offset-4">Find homes within 30 minutes of Augusta →</Link>
      </p>
    </section>
  );
}
