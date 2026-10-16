import { requireStaff } from "@/lib/server/auth";
import { handler } from "@/lib/server/http";
import { dispatcherFetch, type VendorCompliance } from "@/lib/server/dispatcher";

/** GET /api/vendors/compliance — staff-only live COI status of every contractor, from the dispatcher. */
export const GET = handler(async (request: Request) => {
  await requireStaff(request);
  const data = await dispatcherFetch<{ vendors: VendorCompliance[]; mock: boolean; generated_at: string }>("/api/v1/vendors/compliance");
  return Response.json({ vendors: data.vendors, mock: data.mock, generatedAt: data.generated_at });
});
