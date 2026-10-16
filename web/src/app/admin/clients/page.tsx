"use client";

import { useStaff } from "@/components/admin/admin-shell";
import { CollectionsBoard } from "@/components/site/collections-board";

/** Agents see their clients' collections, reactions and notes live, and reply in the thread. */
export default function ClientsPage() {
  const viewer = useStaff();
  return (
    <div>
      <h1 className="type-title">Client collections</h1>
      <p className="mt-1 mb-8 text-ink-2">Synced live — when a client saves, reacts or comments, it appears here instantly.</p>
      <CollectionsBoard viewer={viewer} />
    </div>
  );
}
