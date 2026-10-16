import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { getViewerFromCookies, isStaff } from "@/lib/server/auth";

export const metadata: Metadata = { title: { default: "Team portal", template: "%s · Surette portal" }, robots: { index: false } };

/** Server-side gate: only admins and agents of a team get past here; clients go to Collections. */
async function StaffGate({ children }: { children: ReactNode }) {
  await connection();
  const viewer = await getViewerFromCookies();
  if (!viewer) redirect("/portal/sign-in?next=/admin");
  if (!isStaff(viewer)) redirect("/account");
  return <AdminShell viewer={viewer}>{children}</AdminShell>;
}

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<div className="grid min-h-svh place-items-center bg-ivory text-ink-3">Opening the portal…</div>}>
      <StaffGate>{children}</StaffGate>
    </Suspense>
  );
}
