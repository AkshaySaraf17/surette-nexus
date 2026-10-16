import { requireViewer } from "@/lib/server/auth";
import { handler } from "@/lib/server/http";

export const GET = handler(async (request: Request) => {
  const user = await requireViewer(request);
  return Response.json({ user });
});
