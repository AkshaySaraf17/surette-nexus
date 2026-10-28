import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AccountWorkspace } from "@/components/site/account-workspace";
import { Skeleton } from "@/components/ui/skeleton";
import { getViewerFromCookies } from "@/lib/server/auth";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };

async function Workspace() {
  await connection();
  const viewer = await getViewerFromCookies();
  if (!viewer) redirect("/sign-in?next=/account");
  if (viewer.role !== "client") redirect("/admin");
  return (
    <>
      <h1 className="type-display mt-3">Welcome back, {viewer.fullName.split(" ")[0]}.</h1>
      <div className="mt-10">
        <AccountWorkspace viewer={viewer} />
      </div>
    </>
  );
}

export default function AccountPage() {
  return (
    <div data-tone="ivory" className="mx-auto max-w-[1400px] px-5 pb-32 pt-32 sm:px-8">
      <p className="type-eyebrow text-brand">Your account</p>
      <Suspense fallback={<Skeleton className="mt-6 h-96 w-full rounded-[28px]" />}>
        <Workspace />
      </Suspense>
    </div>
  );
}
