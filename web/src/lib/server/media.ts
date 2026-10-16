import "server-only";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import sharp from "sharp";
import type { ImageRendition } from "@/lib/types";

/**
 * Image ingestion: one upload stream is decoded once by sharp and fanned out
 * (via clone()) into three WebP renditions plus a tiny blurred placeholder,
 * written straight to storage — the original file is never buffered whole in
 * memory. EXIF orientation is applied and all metadata (including GPS) is
 * stripped, so photos never leak where they were taken.
 *
 * Storage is the local directory STORAGE_DIR (default web/.storage), served by
 * the /media/[...key] route with immutable caching. Swap `storageRoot()` and
 * `publicUrl()` for an object store/CDN in multi-instance deployments.
 */

export const RENDITIONS = [
  { name: "xl", width: 2400, quality: 80 },
  { name: "md", width: 1200, quality: 78 },
  { name: "sm", width: 640, quality: 72 },
] as const;

export type RenditionName = (typeof RENDITIONS)[number]["name"];

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif"];
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

export function storageRoot(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.STORAGE_DIR?.trim() || ".storage");
}

export function publicUrl(key: string): string {
  return `/media/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/** Resolve a storage key to an absolute path, refusing anything that escapes the root. */
export function resolveKey(key: string): string | null {
  const root = storageRoot();
  const full = path.resolve(/*turbopackIgnore: true*/ root, key);
  if (!full.startsWith(root + path.sep)) return null;
  return full;
}

export interface ProcessedImage {
  storageKey: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
  blurDataUrl: string;
  variants: Record<RenditionName, ImageRendition>;
}

/**
 * Stream an image into optimized renditions under `keyPrefix` (e.g. "listings/<propertyId>/<assetId>").
 * Rejects (and cleans up) if the input isn't a decodable image.
 */
export async function processImageStream(input: Readable, keyPrefix: string): Promise<ProcessedImage> {
  const dir = resolveKey(path.dirname(`${keyPrefix}-x`));
  if (!dir) throw new Error("Invalid storage key");
  await mkdir(dir, { recursive: true });

  const pipeline = sharp({ failOn: "error", limitInputPixels: 120_000_000, sequentialRead: true }).rotate();

  const renditionJobs = RENDITIONS.map(async (r) => {
    const key = `${keyPrefix}-${r.name}.webp`;
    const file = resolveKey(key)!;
    const info = await pipeline
      .clone()
      .resize({ width: r.width, withoutEnlargement: true })
      .webp({ quality: r.quality, effort: 4, smartSubsample: true })
      .toFile(file);
    return { name: r.name, key, info };
  });
  const blurJob = pipeline.clone().resize({ width: 24 }).blur(1.2).webp({ quality: 40 }).toBuffer();

  input.on("error", (error) => pipeline.destroy(error));
  input.pipe(pipeline);

  try {
    const [renditions, blur] = await Promise.all([Promise.all(renditionJobs), blurJob]);
    const variants = Object.fromEntries(
      renditions.map(({ name, key, info }) => [name, { url: publicUrl(key), width: info.width, height: info.height }]),
    ) as Record<RenditionName, ImageRendition>;
    const xl = renditions.find((r) => r.name === "xl")!;
    return {
      storageKey: xl.key,
      url: variants.xl.url,
      width: xl.info.width,
      height: xl.info.height,
      bytes: renditions.reduce((sum, r) => sum + r.info.size, 0),
      blurDataUrl: `data:image/webp;base64,${blur.toString("base64")}`,
      variants,
    };
  } catch (error) {
    await removeRenditions(keyPrefix);
    throw error;
  }
}

/** Delete every rendition written for `keyPrefix` (used on failure and when an asset is deleted). */
export async function removeRenditions(keyPrefix: string): Promise<void> {
  await Promise.all(
    RENDITIONS.map((r) => {
      const file = resolveKey(`${keyPrefix}-${r.name}.webp`);
      return file ? rm(file, { force: true }) : Promise.resolve();
    }),
  );
}

/** Move a processed image's renditions to a new key prefix (staging → final), rewriting its URLs. */
export async function relocate(image: ProcessedImage, fromPrefix: string, toPrefix: string): Promise<ProcessedImage> {
  const targetDir = resolveKey(path.dirname(`${toPrefix}-x`));
  if (!targetDir) throw new Error("Invalid storage key");
  await mkdir(targetDir, { recursive: true });
  const variants = {} as Record<RenditionName, ImageRendition>;
  for (const r of RENDITIONS) {
    const from = resolveKey(`${fromPrefix}-${r.name}.webp`)!;
    const toKey = `${toPrefix}-${r.name}.webp`;
    await rename(from, resolveKey(toKey)!);
    variants[r.name] = { ...image.variants[r.name], url: publicUrl(toKey) };
  }
  return { ...image, storageKey: `${toPrefix}-xl.webp`, url: variants.xl.url, variants };
}

/** Remove an empty staging directory (ignores errors). */
export async function removeDir(key: string): Promise<void> {
  const dir = resolveKey(key);
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

/** "listings/<id>/<asset>-xl.webp" → "listings/<id>/<asset>" */
export function keyPrefixFromStorageKey(storageKey: string): string {
  return storageKey.replace(/-(xl|md|sm)\.webp$/, "");
}

/** Open a stored file for streaming, or null when missing. */
export async function openStored(key: string): Promise<{ stream: Readable; size: number; contentType: string } | null> {
  const file = resolveKey(key);
  if (!file) return null;
  try {
    const info = await stat(/*turbopackIgnore: true*/ file);
    if (!info.isFile()) return null;
    const ext = path.extname(file).toLowerCase();
    const contentType =
      { ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".mp4": "video/mp4" }[ext] ??
      "application/octet-stream";
    return { stream: createReadStream(/*turbopackIgnore: true*/ file), size: info.size, contentType };
  } catch {
    return null;
  }
}
