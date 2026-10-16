import type { LiveEvent, Viewer } from "@/lib/types";
import type { RawEvent } from "./realtime";

/**
 * Who may hear about a database change. Shared by the SSE endpoint (/api/events) and the
 * WebSocket server so both transports apply exactly the same rules:
 *  - public listing/media changes for this site's team (everyone),
 *  - drafts, showings, leads and deals for staff of that team (customers: their own showings and deal),
 *  - collection activity for the collection's owner and assigned agent.
 * Events carry only ids; clients re-fetch through the API, where RLS applies.
 */
export function canSee(event: RawEvent, viewer: Viewer | null, siteTeamId: string): boolean {
  const staffOfTeam = Boolean(viewer && (viewer.role === "admin" || viewer.role === "agent") && viewer.teamId === event.teamId);
  switch (event.visibility) {
    case "public":
      return event.teamId === siteTeamId || staffOfTeam;
    case "staff":
      return staffOfTeam || (viewer !== null && event.ownerId === viewer.id && ["showings", "transactions", "transaction_milestones"].includes(event.table));
    case "collection":
      return viewer !== null && (event.ownerId === viewer.id || event.agentId === viewer.id);
  }
}

export function toLiveEvent(event: RawEvent): LiveEvent {
  return {
    table: event.table,
    op: event.op,
    propertyId: event.propertyId,
    collectionId: event.collectionId,
    transactionId: event.transactionId ?? null,
    at: event.at,
  };
}
