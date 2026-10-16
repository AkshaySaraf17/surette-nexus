import { withSystemDb } from "@/lib/server/db";
import { handler } from "@/lib/server/http";

/**
 * GET /api/market/datasets — public provenance for the government data behind the market
 * dashboards: the agency, the exact source files (URL, size, SHA-256), when they were
 * downloaded, and how many observations were imported. Latest import per dataset.
 */
export const GET = handler(async () => {
  const rows = await withSystemDb((db) =>
    db.query<{ dataset: string; agency: string; title: string; source_files: { url: string; bytes: number; sha256: string }[]; retrieved_at: Date; imported_at: Date; observations: number; via: string }>(
      `SELECT DISTINCT ON (dataset) dataset, agency, title, source_files, retrieved_at, imported_at, observations, via
         FROM gov_dataset_imports ORDER BY dataset, imported_at DESC`,
    ),
  );
  return Response.json(
    {
      license: "U.S. Government works — public domain (17 U.S.C. § 105).",
      datasets: rows.map((r) => ({ dataset: r.dataset, agency: r.agency, title: r.title, sourceFiles: r.source_files, retrievedAt: r.retrieved_at.toISOString(), importedAt: r.imported_at.toISOString(), observations: r.observations, via: r.via })),
    },
    { headers: { "Cache-Control": "public, max-age=300, s-maxage=600" } },
  );
});
