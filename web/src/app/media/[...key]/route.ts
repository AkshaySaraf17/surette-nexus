import { Readable } from "node:stream";
import { connection } from "next/server";
import { openStored } from "@/lib/server/media";

/**
 * GET /media/<key> — serves optimized uploads from STORAGE_DIR. Keys are content-addressed
 * by asset id, so responses are cached forever (see next.config.ts headers).
 */
export async function GET(_request: Request, { params }: RouteContext<"/media/[...key]">) {
  await connection();
  const { key } = await params;
  const file = await openStored(key.map(decodeURIComponent).join("/"));
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(Readable.toWeb(file.stream) as ReadableStream, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.size),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
