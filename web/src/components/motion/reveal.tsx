import type { ReactNode } from "react";

/*
 * Content appears in place, without fading or sliding in as you scroll. Movement while scrolling
 * made the site harder to follow for some visitors (especially older ones), so these wrappers now
 * render plain, still elements. The props are kept so existing pages don't need to change.
 */

export function Reveal({ children, className }: { children: ReactNode; delay?: number; className?: string; y?: number }) {
  return <div className={className}>{children}</div>;
}

export function RevealWords({ text, className, as = "h2" }: { text: string; className?: string; as?: "h1" | "h2" | "p"; delay?: number }) {
  const Tag = as;
  return <Tag className={className}>{text}</Tag>;
}
