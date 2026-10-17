"use client";

import { SITE_NAME } from "@/lib/site";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X, UserRound } from "lucide-react";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { useSaved } from "./saved-context";
import { Wordmark } from "./wordmark";

const NAV = [
  { href: "/listings", label: "Homes" },
  { href: "/map", label: "Map" },
  { href: "/market", label: "Market" },
  { href: "/dual-move", label: "Sell & Buy" },
  { href: "/team", label: "Team" },
];

const DARK_TONES = new Set(["night", "pine", "navy"]);

/**
 * Translucent global navigation. Its ink flips to white over dark scroll tones
 * (the hero photos, the full-screen scenes) and back to ink over light sections.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { viewer, refreshViewer } = useSaved();
  const [onDark, setOnDark] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setOnDark(DARK_TONES.has(root.dataset.tone ?? ""));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["data-tone"] });
    return () => observer.disconnect();
  }, []);

  async function signOut() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    await refreshViewer();
    router.refresh();
  }

  const staff = viewer && (viewer.role === "admin" || viewer.role === "agent");

  return (
    <header className={cn("fixed inset-x-0 top-0 z-40 transition-colors duration-700", onDark ? "text-white" : "text-ink")}>
      <div className={cn("transition-[background-color,border-color] duration-700", onDark ? "border-b border-white/10 bg-black/15 backdrop-blur-xl" : "material border-b border-line")}>
        <nav aria-label="Main" className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-6 px-5 sm:px-8">
          <Link href="/" aria-label={`${SITE_NAME} home`} className="shrink-0">
            <Wordmark />
          </Link>
          <ul className="hidden items-center gap-8 text-[0.8125rem] font-medium tracking-wide md:flex">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={pathname.startsWith(item.href) ? "page" : undefined}
                  className={cn("relative py-2 opacity-80 transition-opacity hover:opacity-100", pathname.startsWith(item.href) && "opacity-100")}
                >
                  {item.label}
                  {pathname.startsWith(item.href) && <motion.span layoutId="nav-underline" className="absolute inset-x-0 -bottom-0.5 h-px bg-current" />}
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden items-center gap-3 md:flex">
            {staff ? (
              <Link href="/admin" className="text-[0.8125rem] font-medium opacity-80 hover:opacity-100">Portal</Link>
            ) : viewer ? (
              <Link href="/account" className="text-[0.8125rem] font-medium opacity-80 hover:opacity-100">My account</Link>
            ) : null}
            {viewer ? (
              <button type="button" onClick={signOut} className="pressable flex items-center gap-2 rounded-full border border-current/25 px-3.5 py-1.5 text-[0.8125rem]">
                <UserRound className="size-3.5" aria-hidden /> {viewer.fullName.split(" ")[0]} · Sign out
              </button>
            ) : (
              <Link href="/sign-in" className="pressable rounded-full border border-current/30 px-4 py-1.5 text-[0.8125rem] font-medium">
                Sign in
              </Link>
            )}
          </div>
          <button type="button" className="pressable grid size-10 place-items-center md:hidden" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={open ? "Close menu" : "Open menu"}>
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </nav>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ type: "spring", bounce: 0, duration: 0.35 }}
            className="material border-b border-line text-ink md:hidden"
          >
            <ul className="flex flex-col px-5 py-3">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} onClick={() => setOpen(false)} className="block py-3 text-lg">
                    {item.label}
                  </Link>
                </li>
              ))}
              {staff ? (
                <li>
                  <Link href="/admin" onClick={() => setOpen(false)} className="block py-3 text-lg">Team portal</Link>
                </li>
              ) : viewer ? (
                <li>
                  <Link href="/account" onClick={() => setOpen(false)} className="block py-3 text-lg">My account</Link>
                </li>
              ) : null}
              <li className="border-t border-line pt-3">
                {viewer ? (
                  <button type="button" onClick={signOut} className="py-3 text-lg">
                    Sign out
                  </button>
                ) : (
                  <Link href="/sign-in" onClick={() => setOpen(false)} className="block py-3 text-lg">
                    Sign in
                  </Link>
                )}
              </li>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
