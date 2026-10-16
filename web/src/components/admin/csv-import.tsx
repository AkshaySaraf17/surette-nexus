"use client";

import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

const TEMPLATE = `source_ref,title,address,city,state,zip,price,status,listing_type,property_type,bedrooms,full_baths,half_baths,sqft,lot_sqft,year_built,garage_spaces,latitude,longitude,description,amenities
MLS-1001,Example Cape,12 Example Rd,Waterville,ME,04901,349000,draft,sale,single_family,3,2,0,1650,21780,1952,1,44.5512,-69.6400,"A tidy Cape near downtown.",Fireplace|Deck`;

/** Bulk import of listings from a CSV the brokerage supplies (validated row by row). */
export function CsvImport({ onDone }: { onDone: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; errors: number; results: { row: number; status: string; title: string; message?: string }[] } | null>(null);
  const [error, setError] = useState("");

  async function upload() {
    const f = file.current?.files?.[0];
    if (!f) return setError("Choose a CSV file.");
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/properties/import", { method: "POST", headers: { "Content-Type": "text/csv" }, body: await f.text() });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Import failed.");
      setResult(data);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded-[24px] bg-paper p-5 ring-1 ring-line">
      <summary className="cursor-pointer text-sm font-medium">Import listings from CSV</summary>
      <p className="mt-2 text-[0.8125rem] text-ink-2">Use your own listing data or an authorized MLS export. Each row is validated; re-importing a row with the same source_ref updates it. New rows default to drafts.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input ref={file} type="file" accept=".csv,text/csv" aria-label="CSV file" className="text-sm" />
        <Button size="sm" onClick={() => void upload()} disabled={busy}><Upload /> {busy ? "Importing…" : "Import"}</Button>
        <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="surette-listings-template.csv" className="inline-flex items-center gap-1 text-[0.8125rem] underline underline-offset-4"><Download className="size-3.5" /> Template</a>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {result && (
        <div className="mt-3 text-sm">
          <p>{result.created} created · {result.updated} updated · {result.errors} with errors</p>
          {result.errors > 0 && <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-[0.8125rem] text-danger">{result.results.filter((r) => r.status === "error").map((r) => <li key={r.row}>Row {r.row} ({r.title}): {r.message}</li>)}</ul>}
        </div>
      )}
    </details>
  );
}
