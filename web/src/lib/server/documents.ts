import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { dollarsToCents } from "@/lib/money";
import { resolveKey, storageRoot } from "./media";

/**
 * Confidential transaction documents.
 *
 * - Stored under STORAGE_DIR/deals/<transactionId>/<documentId> — NOT under the public
 *   /media route. Downloads go through /api/deals/:id/documents/:docId, which checks
 *   deal access (RLS) on every request.
 * - Treated as untrusted input: size-limited, type-checked by magic bytes (not just the
 *   declared MIME type), hashed, and never executed or rendered inline as HTML.
 * - Optional extraction finds *candidate* values (price, dates, deposit) with their source
 *   text. They're stored as "needs review" and never applied until a person verifies them.
 */

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export function sniffType(buf: Buffer): "application/pdf" | "image/jpeg" | "image/png" | "text/plain" | null {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  // Plain text: valid UTF-8 with no NUL bytes in the first 4 KB.
  const head = buf.subarray(0, 4096);
  if (!head.includes(0) && Buffer.from(head.toString("utf8"), "utf8").length === head.length) return "text/plain";
  return null;
}

export function documentKey(transactionId: string, documentId: string) {
  return `deals/${transactionId}/${documentId}`;
}

export async function storeDocument(key: string, buf: Buffer) {
  const file = resolveKey(key);
  if (!file) throw new Error("Invalid key");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buf, { mode: 0o600 });
  return createHash("sha256").update(buf).digest("hex");
}

export async function readDocument(key: string): Promise<Buffer | null> {
  const file = resolveKey(key);
  if (!file || !file.startsWith(path.join(storageRoot(), "deals"))) return null;
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}

export async function deleteDocument(key: string) {
  const file = resolveKey(key);
  if (file) await rm(file, { force: true });
}

async function pdfText(buf: Buffer): Promise<{ page: number; text: string }[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false, disableFontFace: true });
  const doc = await task.promise;
  const pages: { page: number; text: string }[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 30); i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push({ page: i, text: content.items.map((it) => ("str" in it ? it.str : "")).join(" ").replace(/\s+/g, " ") });
  }
  await task.destroy();
  return pages;
}

export interface Extracted {
  field: "purchase_price" | "earnest_money" | "closing_date" | "inspection_days" | "effective_date";
  label: string;
  value: string;
  normalized: string | number;
  source: string;
}

const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december";
function toIsoDate(raw: string): string | null {
  const us = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(raw);
  if (us) {
    const year = us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
    const d = new Date(Date.UTC(year, Number(us[1]) - 1, Number(us[2])));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const named = new RegExp(`(${MONTHS})\\s+(\\d{1,2}),?\\s+(\\d{4})`, "i").exec(raw);
  if (named) {
    const d = new Date(`${named[1]} ${named[2]}, ${named[3]} UTC`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  return null;
}

/** Find candidate contract values with the text they came from. Pure pattern matching — no AI. */
export function findCandidates(pages: { page: number; text: string }[]): Extracted[] {
  const out: Extracted[] = [];
  const date = `((?:\\d{1,2}/\\d{1,2}/\\d{2,4})|(?:(?:${MONTHS})\\s+\\d{1,2},?\\s+\\d{4}))`;
  const money = "\\$\\s?([\\d,]+(?:\\.\\d{2})?)";
  const rules: { field: Extracted["field"]; label: string; re: RegExp; kind: "money" | "date" | "days" }[] = [
    { field: "purchase_price", label: "Purchase price", re: new RegExp(`(purchase price|sale price|total price)[^$]{0,60}${money}`, "i"), kind: "money" },
    { field: "earnest_money", label: "Earnest money deposit", re: new RegExp(`(earnest money|deposit)[^$]{0,60}${money}`, "i"), kind: "money" },
    { field: "closing_date", label: "Closing date", re: new RegExp(`(closing|close of escrow|transfer of title)[^.]{0,80}?${date}`, "i"), kind: "date" },
    { field: "effective_date", label: "Effective date", re: new RegExp(`(effective date|date of (?:this )?agreement)[^.]{0,40}?${date}`, "i"), kind: "date" },
    { field: "inspection_days", label: "Inspection period (days)", re: /(inspection)[^.]{0,80}?(\d{1,2})\s*(?:calendar\s*|business\s*)?days/i, kind: "days" },
  ];
  for (const rule of rules) {
    for (const p of pages) {
      const m = rule.re.exec(p.text);
      if (!m) continue;
      const raw = m[m.length - 1];
      let normalized: string | number | null = null;
      if (rule.kind === "money") normalized = dollarsToCents(raw);
      else if (rule.kind === "date") normalized = toIsoDate(raw);
      else normalized = Number(raw);
      if (normalized === null || normalized === 0) continue;
      const start = Math.max(0, m.index - 40);
      out.push({
        field: rule.field,
        label: rule.label,
        value: raw,
        normalized,
        source: `page ${p.page}: “…${p.text.slice(start, m.index + m[0].length + 20).trim()}…”`,
      });
      break;
    }
  }
  return out;
}

export async function extractCandidates(mime: string, buf: Buffer): Promise<Extracted[]> {
  try {
    if (mime === "application/pdf") return findCandidates(await pdfText(buf));
    if (mime === "text/plain") return findCandidates([{ page: 1, text: buf.toString("utf8").replace(/\s+/g, " ") }]);
  } catch (error) {
    console.warn("[documents] extraction failed:", error instanceof Error ? error.message : error);
  }
  return []; // images: no OCR in this version
}
