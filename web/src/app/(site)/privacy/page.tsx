import type { Metadata } from "next";
import Link from "next/link";
import { PrivacyControls } from "@/components/site/privacy-controls";

export const metadata: Metadata = { title: "Privacy & cookies" };

/**
 * Plain-language data notice. This describes how the software behaves; the brokerage should have
 * it reviewed for its own legal obligations — a notice like this is not by itself a guarantee of compliance.
 */
export default function PrivacyPage() {
  const rows: [string, string, string, string][] = [
    ["Anonymous analytics (only if you click Allow)", "Pages viewed, scroll depth, clicks on listings and buttons, referring site and campaign tags, device type. A random session id, and a random visitor id kept in your browser. Never form contents, names or emails.", "Understand which pages and homes help visitors, and fix what doesn't.", "Up to 13 months, then deleted automatically."],
    ["Account (if you create one)", "Name, email, optional phone, password (hashed), saved homes, searches, comparisons and sell-and-buy plans.", "Let you use your saved items on any device and share collections with your agent.", "Until you delete your account (Account → Privacy & data)."],
    ["Requests you send", "What you enter when you contact us, request a showing or send a plan to an agent, with the consent you gave.", "Respond to your request.", "Kept as a brokerage business record; ask the office to erase it."],
    ["AI assistant chats", "Messages are processed to search listings and are not stored, unless you're signed in (your own search history) or you send a request to an agent.", "Answer your question.", "Search history: until you clear it."],
  ];
  return (
    <div data-tone="paper" className="mx-auto max-w-4xl px-5 pb-32 pt-32 sm:px-8">
      <p className="type-eyebrow text-gold">Privacy</p>
      <h1 className="type-display mt-3">What we collect, and why.</h1>
      <p className="type-lede mt-5 text-ink-2">We collect as little as we can, keep it on our own servers, and never sell it. There are no third-party ad trackers on this site.</p>
      <div className="mt-12 overflow-x-auto rounded-[24px] bg-paper ring-1 ring-line">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-[0.75rem] uppercase tracking-[0.1em] text-ink-3"><tr><th className="p-4 font-medium">Data</th><th className="p-4 font-medium">What exactly</th><th className="p-4 font-medium">Why</th><th className="p-4 font-medium">How long</th></tr></thead>
          <tbody className="divide-y divide-line align-top">{rows.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i} className={i === 0 ? "p-4 font-medium" : "p-4 text-ink-2"}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <h2 className="type-title mt-14">Your choices</h2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-ink-2">
        <li>Analytics is off until you allow it. Browsers sending Global Privacy Control or Do Not Track are treated as &ldquo;no&rdquo;.</li>
        <li>Change your analytics choice below at any time; declining deletes the random visitor id from this browser.</li>
        <li>Signed-in customers can download or delete everything from <Link href="/account" className="underline underline-offset-4">Account → Privacy & data</Link>.</li>
        <li>We don&rsquo;t connect anonymous browsing to your identity. Agents see what you send them, not your browsing history.</li>
        <li>Our search and recommendations never use race, religion, national origin, sex, disability, familial status or other protected characteristics.</li>
      </ul>
      <PrivacyControls />
      <p className="mt-12 text-sm text-ink-3">Questions: <a href="mailto:jjolicoeur@surette-realestate.com" className="underline">jjolicoeur@surette-realestate.com</a> · (207) 649-6893.</p>
    </div>
  );
}
