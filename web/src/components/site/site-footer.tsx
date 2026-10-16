import Link from "next/link";
import { Wordmark } from "./wordmark";

export function SiteFooter() {
  return (
    <footer data-tone="night" className="relative z-[2] bg-[#0b0a08] text-[#f3efe7]">
      <div className="mx-auto grid max-w-[1400px] gap-12 px-5 py-20 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Wordmark />
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-white/60">
            113 Silver Street, Waterville, ME 04901 · <a href="tel:+12076496893" className="underline-offset-4 hover:underline">(207) 649-6893</a> · <a href="mailto:jjolicoeur@surette-realestate.com" className="underline-offset-4 hover:underline">jjolicoeur@surette-realestate.com</a>
          </p>
        </div>
        <nav aria-label="Explore" className="text-sm">
          <p className="type-eyebrow text-white/60">Explore</p>
          <ul className="mt-4 space-y-2.5 text-white/75">
            <li><Link href="/listings" className="hover:text-white">Available homes</Link></li>
            <li><Link href="/listings?sold=1" className="hover:text-white">Recently sold</Link></li>
            <li><Link href="/map" className="hover:text-white">Map &amp; neighborhoods</Link></li>
            <li><Link href="/team" className="hover:text-white">Our team</Link></li>
          </ul>
        </nav>
        <nav aria-label="Clients" className="text-sm">
          <p className="type-eyebrow text-white/60">Clients</p>
          <ul className="mt-4 space-y-2.5 text-white/75">
            <li><Link href="/account" className="hover:text-white">Your account &amp; saved homes</Link></li>
            <li><Link href="/dual-move" className="hover:text-white">Dual-Move Copilot</Link></li>
            <li><Link href="/market" className="hover:text-white">Market intelligence</Link></li>
            <li><Link href="/maintenance" className="hover:text-white">Tenant maintenance request</Link></li>
            <li><Link href="/sign-in" className="hover:text-white">Customer sign-in</Link></li>
          </ul>
        </nav>
        <nav aria-label="Company" className="text-sm">
          <p className="type-eyebrow text-white/60">Company</p>
          <ul className="mt-4 space-y-2.5 text-white/75">
            <li><Link href="/portal/sign-in" className="hover:text-white">Property management sign-in</Link></li>
            <li><Link href="/privacy" className="hover:text-white">Privacy &amp; cookies</Link></li>
            <li><Link href="/contact" className="hover:text-white">Contact</Link></li>
            <li><Link href="/credits" className="hover:text-white">Photo &amp; film credits</Link></li>
          </ul>
        </nav>
      </div>
      <div className="mx-auto flex max-w-[1400px] flex-wrap justify-between gap-4 border-t border-white/10 px-5 py-6 text-xs text-white/60 sm:px-8">
        <p>© Surette Real Estate. Equal Housing Opportunity.</p>
        <p>Commute times and Walk Index are estimates. Listing information is deemed reliable but not guaranteed.</p>
      </div>
    </footer>
  );
}
