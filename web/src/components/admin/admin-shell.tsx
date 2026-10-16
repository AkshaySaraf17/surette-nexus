"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  BarChart3,
  Building2,
  CalendarClock,
  ClipboardList,
  Droplets,
  Gauge,
  Handshake,
  HardHat,
  Heart,
  Menu,
  Settings,
  Users,
  Webhook,
  X,
} from "lucide-react";
import { api } from "@/lib/client-api";
import type { Viewer } from "@/lib/types";
import { useLiveStatus } from "@/lib/use-live";
import { cn } from "@/lib/utils";
import { Wordmark } from "@/components/site/wordmark";
import { OpsAssistant } from "./ops-assistant";

const NAV: { href: string; label: string; icon: typeof Gauge; ownerOnly?: boolean; section: string }[] = [
  { href: "/admin", label: "Dashboard", icon: Gauge, section: "Work" },
  { href: "/admin/leads", label: "Leads", icon: ClipboardList, section: "Work" },
  { href: "/admin/deals", label: "Deals", icon: Handshake, section: "Work" },
  { href: "/admin/showings", label: "Showings", icon: CalendarClock, section: "Work" },
  { href: "/admin/clients", label: "Client collections", icon: Heart, section: "Work" },
  { href: "/admin/listings", label: "Listings", icon: Building2, section: "Properties" },
  { href: "/admin/utilities", label: "Utilities", icon: Droplets, section: "Properties" },
  { href: "/admin/vendors", label: "Vendors", icon: HardHat, section: "Properties" },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3, section: "Insights" },
  { href: "/admin/team", label: "Team & accounts", icon: Users, section: "Admin" },
  { href: "/admin/settings", label: "Settings", icon: Settings, ownerOnly: true, section: "Admin" },
  { href: "/admin/webhooks", label: "Webhooks", icon: Webhook, ownerOnly: true, section: "Admin" },
];

const StaffContext = createContext<Viewer | null>(null);
export const useStaff = () => useContext(StaffContext)!;

/** Portal chrome. The server layout (app/admin/layout.tsx) has already verified the viewer is staff. */
export function AdminShell({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const live = useLiveStatus();
  const [open, setOpen] = useState(false);
  const items = NAV.filter((n) => !n.ownerOnly || viewer.role === "admin");
  const sections = [...new Set(items.map((i) => i.section))];

  const nav = (
    <nav aria-label="Portal" className="space-y-6">
      {sections.map((section) => (
        <div key={section}>
          <p className="px-3 text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-ink-3">{section}</p>
          <ul className="mt-2 space-y-0.5">
            {items
              .filter((i) => i.section === section)
              .map((item) => {
                const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
                return (
                  <li key={item.href}>
                    <Link href={item.href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined} className="relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm">
                      {active && <motion.span layoutId="admin-nav" className="absolute inset-0 rounded-xl bg-fill" transition={{ type: "spring", bounce: 0, duration: 0.35 }} />}
                      <item.icon className={cn("relative size-4", active ? "text-gold" : "text-ink-3")} aria-hidden />
                      <span className={cn("relative", active ? "font-medium text-ink" : "text-ink-2")}>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <StaffContext.Provider value={viewer}>
      <div className="min-h-svh bg-ivory text-ink lg:grid lg:grid-cols-[260px_1fr]">
        <aside className="sticky top-0 hidden h-svh flex-col border-r border-line bg-paper px-4 py-6 lg:flex">
          <Link href="/admin" className="px-3"><Wordmark className="[&>span:first-child]:text-[1.2rem]" /></Link>
          <p className="mt-1 px-3 text-[0.6875rem] uppercase tracking-[0.18em] text-ink-3">Property management</p>
          <div className="mt-8 flex-1 overflow-y-auto">{nav}</div>
          <div className="border-t border-line px-3 pt-4 text-[0.8125rem]">
            <p className="font-medium">{viewer.fullName}</p>
            <p className="text-ink-3">{viewer.role === "admin" ? "Owner / administrator" : "Agent"}</p>
            <div className="mt-3 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-ink-3"><span className={cn("size-2 rounded-full", live ? "bg-success" : "bg-ink-3")} />{live ? "Live" : "Connecting"}</span>
              <span className="flex gap-3">
                <Link href="/" className="text-ink-2 hover:text-ink">Site</Link>
                <button type="button" className="text-ink-2 hover:text-ink" onClick={async () => { await api("/api/auth/logout", { method: "POST" }); router.replace("/portal/sign-in"); }}>Sign out</button>
              </span>
            </div>
          </div>
        </aside>

        <header className="material sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line px-4 lg:hidden">
          <Link href="/admin"><Wordmark /></Link>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={open ? "Close menu" : "Open menu"} className="pressable grid size-10 place-items-center">
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </header>
        {open && (
          <div className="fixed inset-x-0 top-14 z-40 max-h-[calc(100svh-3.5rem)] overflow-y-auto border-b border-line bg-paper px-4 py-5 lg:hidden">
            {nav}
            <button type="button" className="mt-6 px-3 text-sm text-ink-2" onClick={async () => { await api("/api/auth/logout", { method: "POST" }); router.replace("/portal/sign-in"); }}>Sign out</button>
          </div>
        )}

        <main id="main" className="min-w-0 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">{children}</main>
      </div>
      <OpsAssistant />
    </StaffContext.Provider>
  );
}
