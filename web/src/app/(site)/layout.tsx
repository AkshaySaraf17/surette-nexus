import Link from "next/link";
import { SITE_NAME } from "@/lib/site";
import { Suspense } from "react";
import { CursorGlare } from "@/components/motion/cursor-glare";
import { ScrollTone } from "@/components/motion/scroll-tone";
import { SmoothScroll } from "@/components/motion/smooth-scroll";
import { Analytics } from "@/components/site/analytics";
import { Assistant } from "@/components/site/assistant";
import { SavedProvider } from "@/components/site/saved-context";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { Wordmark } from "@/components/site/wordmark";

/** Static stand-in painted in the prerendered shell until the URL-aware header hydrates. */
function HeaderShell() {
  return (
    <header className="material fixed inset-x-0 top-0 z-40 border-b border-line">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center px-5 sm:px-8">
        <Link href="/" aria-label={`${SITE_NAME} home`}><Wordmark /></Link>
      </div>
    </header>
  );
}

/** Public site chrome: header, scroll-reactive palette, cursor glare, AI assistant and footer. */
export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <SavedProvider>
      <SmoothScroll />
      <ScrollTone />
      <CursorGlare />
      <Suspense fallback={<HeaderShell />}>
        <SiteHeader />
      </Suspense>
      <main id="main" className="relative z-[2]">
        {children}
      </main>
      <SiteFooter />
      <Analytics />
      <Suspense>
        <Assistant />
      </Suspense>
    </SavedProvider>
  );
}
