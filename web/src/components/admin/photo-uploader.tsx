"use client";

import { AnimatePresence, Reorder, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { ImagePlus, Star, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Multi-image drag-and-drop uploader. Drop or pick photos, drag to reorder,
 * star the cover and add alt text. Files stay in the browser until the parent
 * form submits them as one multipart request (see uploadListing below).
 */

export interface PendingPhoto {
  id: string;
  file: File;
  preview: string;
  alt: string;
}

const ACCEPT = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif"];
const MAX_BYTES = 30 * 1024 * 1024;

export function PhotoUploader({
  photos,
  onChange,
  coverId,
  onCoverChange,
  disabled,
}: {
  photos: PendingPhoto[];
  onChange: (photos: PendingPhoto[]) => void;
  coverId: string | null;
  onCoverChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.preview)), []);

  const add = useCallback(
    (files: FileList | File[]) => {
      const accepted: PendingPhoto[] = [];
      const bad: string[] = [];
      for (const file of Array.from(files)) {
        if (!ACCEPT.includes(file.type.toLowerCase())) bad.push(`${file.name}: not a supported image`);
        else if (file.size > MAX_BYTES) bad.push(`${file.name}: larger than 30 MB`);
        else accepted.push({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file), alt: "" });
      }
      setRejected(bad);
      const next = [...photosRef.current, ...accepted].slice(0, 40);
      onChange(next);
      if (!coverId && next[0]) onCoverChange(next[0].id);
    },
    [onChange, coverId, onCoverChange],
  );

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (!disabled && e.dataTransfer.files.length) add(e.dataTransfer.files);
  }

  function remove(id: string) {
    const target = photos.find((p) => p.id === id);
    if (target) URL.revokeObjectURL(target.preview);
    const next = photos.filter((p) => p.id !== id);
    onChange(next);
    if (coverId === id) onCoverChange(next[0]?.id ?? null);
  }

  return (
    <div>
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={onDrop}
        className={cn(
          "relative grid place-items-center rounded-[24px] border-2 border-dashed px-6 py-12 text-center transition-colors",
          dragging ? "border-gold bg-gold/10" : "border-line-strong bg-paper",
          disabled && "opacity-50",
        )}
      >
        <ImagePlus className="size-8 text-gold" aria-hidden />
        <p className="mt-3 font-medium">Drag photos here</p>
        <p className="mt-1 text-sm text-ink-2">JPEG, PNG, WebP, AVIF or HEIC · up to 30 MB each · 40 per upload</p>
        <button type="button" disabled={disabled} onClick={() => input.current?.click()} className="pressable mt-5 rounded-full border border-line-strong px-4 py-2 text-sm font-medium hover:bg-fill">
          Choose photos
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT.join(",")}
          multiple
          className="sr-only"
          onChange={(e) => {
            if (e.target.files) add(e.target.files);
            e.target.value = "";
          }}
          aria-label="Choose photos to upload"
        />
      </div>
      {rejected.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-danger" role="alert">
          {rejected.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}

      {photos.length > 0 && (
        <>
          <p className="mt-6 text-sm text-ink-2">{photos.length} photo{photos.length === 1 ? "" : "s"} · drag to reorder · ★ marks the cover</p>
          <Reorder.Group axis="y" values={photos} onReorder={onChange} className="mt-3 space-y-2.5">
            <AnimatePresence initial={false}>
              {photos.map((p, i) => (
                <Reorder.Item
                  key={p.id}
                  value={p}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  whileDrag={{ scale: 1.02, boxShadow: "0 18px 40px -12px rgb(0 0 0 / .3)" }}
                  className="flex cursor-grab items-center gap-3 rounded-2xl bg-paper p-2.5 ring-1 ring-line active:cursor-grabbing"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                  <img src={p.preview} alt="" className="size-16 shrink-0 rounded-xl object-cover" draggable={false} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{i + 1}. {p.file.name}</p>
                    <label className="sr-only" htmlFor={`alt-${p.id}`}>Alt text for {p.file.name}</label>
                    <input
                      id={`alt-${p.id}`}
                      value={p.alt}
                      onChange={(e) => onChange(photos.map((x) => (x.id === p.id ? { ...x, alt: e.target.value } : x)))}
                      onPointerDown={(e) => e.stopPropagation()}
                      placeholder="Describe the photo (for screen readers)"
                      maxLength={300}
                      className="mt-1 w-full rounded-lg border border-line bg-transparent px-2.5 py-1.5 text-[0.8125rem] focus:border-gold focus:outline-none"
                    />
                  </div>
                  <button type="button" onClick={() => onCoverChange(p.id)} aria-pressed={coverId === p.id} aria-label={`Make ${p.file.name} the cover photo`} className={cn("pressable grid size-9 place-items-center rounded-full", coverId === p.id ? "bg-gold text-white" : "text-ink-3 hover:bg-fill")}>
                    <Star className={cn("size-4", coverId === p.id && "fill-current")} />
                  </button>
                  <button type="button" onClick={() => remove(p.id)} aria-label={`Remove ${p.file.name}`} className="pressable grid size-9 place-items-center rounded-full text-ink-3 hover:bg-fill hover:text-danger">
                    <X className="size-4" />
                  </button>
                </Reorder.Item>
              ))}
            </AnimatePresence>
          </Reorder.Group>
        </>
      )}
    </div>
  );
}

/**
 * Send listing metadata + photos to /api/properties/upload as one multipart request,
 * reporting upload progress (XHR is used because fetch has no upload progress).
 */
export function uploadListing(
  form: { propertyId?: string; metadata?: unknown; photos: PendingPhoto[]; coverId: string | null },
  onProgress: (fraction: number) => void,
): Promise<{ property: { id: string; slug: string; status: string } ; uploaded: number }> {
  const body = new FormData();
  if (form.propertyId) body.append("propertyId", form.propertyId);
  if (form.metadata !== undefined) body.append("metadata", JSON.stringify(form.metadata));
  body.append("alts", JSON.stringify(form.photos.map((p) => p.alt)));
  const cover = form.photos.findIndex((p) => p.id === form.coverId);
  if (cover >= 0) body.append("coverIndex", String(cover));
  for (const p of form.photos) body.append("files", p.file, p.file.name);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/properties/upload");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
      else reject(Object.assign(new Error(xhr.response?.error?.message ?? `Upload failed (${xhr.status})`), { fields: xhr.response?.error?.fields ?? {} }));
    };
    xhr.onerror = () => reject(Object.assign(new Error("Network error — check your connection and try again."), { fields: {} }));
    xhr.send(body);
  });
}

export function UploadProgress({ value }: { value: number | null }) {
  if (value === null) return null;
  const pct = Math.round(value * 100);
  return (
    <div className="mt-4" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
      <div className="h-1.5 overflow-hidden rounded-full bg-fill">
        <motion.div className="h-full rounded-full bg-gold" animate={{ width: `${pct}%` }} transition={{ type: "spring", bounce: 0, duration: 0.3 }} />
      </div>
      <p className="mt-2 text-[0.8125rem] text-ink-2">{pct < 100 ? `Uploading… ${pct}%` : "Optimizing photos and publishing…"}</p>
    </div>
  );
}
