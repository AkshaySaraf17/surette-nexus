"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent, Marker } from "maplibre-gl";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Car, Footprints, GraduationCap, X } from "lucide-react";
import { Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/client-api";
import {
  AMENITIES,
  COMMUTE_ANCHORS,
  DISTRICTS,
  MAP_CENTER,
  SCHOOLS,
  circlePolygon,
  driveRadiusKm,
  estimateDriveMinutes,
  walkIndexLabel,
  type LngLat,
} from "@/lib/geo";
import { formatPriceCompact, formatPrice, formatRent } from "@/lib/money";
import type { ListingCard } from "@/lib/types";
import { useLiveEvents } from "@/lib/use-live";
import { cn, formatBaths } from "@/lib/utils";
import { ListingImage } from "./listing-image";

/**
 * Trulia-style map. Price pins for every listing (click → preview card → one more
 * click to the listing) plus three toggleable context layers:
 *   • School districts — approximate district areas and every school
 *   • Commute — 10/20/30/45-minute drive rings to a chosen destination
 *   • Walkability — a heat layer of everyday destinations (our Walk Index inputs)
 * Pins update live when listings change. Tiles: OpenFreeMap (OpenStreetMap data).
 */

const COMMUTE_MINUTES = [10, 20, 30, 45];
const RING_COLORS = ["#2f6f4f", "#5f8f3f", "#b08d2f", "#b0553a"];

function featureCollection<T extends GeoJSON.Geometry>(features: GeoJSON.Feature<T>[]): GeoJSON.FeatureCollection<T> {
  return { type: "FeatureCollection", features };
}

export function MapExplorer({ initial, focusSlug }: { initial: ListingCard[]; focusSlug?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<Map<string, Marker>>(new Map());
  const [ready, setReady] = useState(false);
  const [listings, setListings] = useState(initial);
  const [selected, setSelected] = useState<ListingCard | null>(() => initial.find((l) => l.slug === focusSlug) ?? null);
  const [layers, setLayers] = useState({ schools: true, commute: false, walk: false });
  const [anchorId, setAnchorId] = useState(COMMUTE_ANCHORS[0].id);
  const anchor = COMMUTE_ANCHORS.find((a) => a.id === anchorId)!;

  // ---- map bootstrap -------------------------------------------------------
  useEffect(() => {
    let disposed = false;
    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (disposed || !container.current) return;
      // Copied by scripts/copy-vendor.mjs (postinstall); MapLibre v6 workers are ES modules.
      maplibregl.setWorkerUrl("/vendor/maplibre/maplibre-gl-worker.mjs");
      const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const m = new maplibregl.Map({
        container: container.current,
        style: `https://tiles.openfreemap.org/styles/${dark ? "dark" : "positron"}`,
        center: MAP_CENTER,
        zoom: 11.2,
        attributionControl: { compact: true },
        cooperativeGestures: false,
      });
      m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
      m.on("load", () => {
        if (disposed) return;
        // District areas
        m.addSource("districts", {
          type: "geojson",
          data: featureCollection(
            DISTRICTS.map((d) => ({ type: "Feature", properties: { name: d.name, color: d.color }, geometry: circlePolygon(d.center, d.radiusKm) })),
          ),
        });
        m.addLayer({ id: "districts-fill", type: "fill", source: "districts", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.1 } });
        m.addLayer({ id: "districts-line", type: "line", source: "districts", paint: { "line-color": ["get", "color"], "line-width": 1.5, "line-dasharray": [2, 2] } });
        m.addLayer({
          id: "districts-label",
          type: "symbol",
          source: "districts",
          layout: { "text-font": ["Noto Sans Regular"], "text-field": ["get", "name"], "text-size": 11, "text-letter-spacing": 0.05, "symbol-placement": "point" },
          paint: { "text-color": ["get", "color"], "text-halo-color": dark ? "#000" : "#fff", "text-halo-width": 1.5 },
        });
        // Schools
        m.addSource("schools", {
          type: "geojson",
          data: featureCollection(SCHOOLS.map((s) => ({ type: "Feature", properties: { name: s.name, level: s.level }, geometry: { type: "Point", coordinates: s.position } }))),
        });
        m.addLayer({
          id: "schools-dot",
          type: "circle",
          source: "schools",
          paint: { "circle-radius": 6, "circle-color": "#1f3a32", "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
        });
        m.addLayer({
          id: "schools-label",
          type: "symbol",
          source: "schools",
          minzoom: 11.5,
          layout: { "text-font": ["Noto Sans Regular"], "text-field": ["concat", ["get", "name"], "\n", ["get", "level"]], "text-size": 10.5, "text-offset": [0, 1.3], "text-anchor": "top" },
          paint: { "text-color": dark ? "#e8e4dc" : "#1f3a32", "text-halo-color": dark ? "#000" : "#fff", "text-halo-width": 1.4 },
        });
        // Commute rings
        m.addSource("commute", { type: "geojson", data: featureCollection([]) });
        m.addLayer({ id: "commute-fill", type: "fill", source: "commute", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.07 } });
        m.addLayer({ id: "commute-line", type: "line", source: "commute", paint: { "line-color": ["get", "color"], "line-width": 1.6 } });
        m.addLayer({
          id: "commute-label",
          type: "symbol",
          source: "commute",
          layout: { "text-font": ["Noto Sans Regular"], "text-field": ["get", "label"], "text-size": 11, "symbol-placement": "line", "text-letter-spacing": 0.08 },
          paint: { "text-color": ["get", "color"], "text-halo-color": dark ? "#000" : "#fff", "text-halo-width": 1.5 },
        });
        // Walkability heat
        m.addSource("walk", {
          type: "geojson",
          data: featureCollection(AMENITIES.map((a) => ({ type: "Feature", properties: { weight: a.weight, name: a.name }, geometry: { type: "Point", coordinates: a.position } }))),
        });
        m.addLayer({
          id: "walk-heat",
          type: "heatmap",
          source: "walk",
          paint: {
            "heatmap-weight": ["get", "weight"],
            "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 15, 2],
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 22, 13, 60, 16, 140],
            "heatmap-opacity": 0.6,
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0,
              "rgba(0,0,0,0)",
              0.2,
              "rgba(120,180,140,0.35)",
              0.5,
              "rgba(176,141,47,0.55)",
              0.8,
              "rgba(200,90,50,0.7)",
              1,
              "rgba(160,40,40,0.8)",
            ],
          },
        });
        m.on("click", "schools-dot", (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f) return;
          new maplibregl.Popup({ closeButton: false, offset: 10 })
            .setLngLat((f.geometry as GeoJSON.Point).coordinates as LngLat)
            .setHTML(`<div style="padding:10px 12px;font-size:13px"><strong>${String(f.properties?.name)}</strong><br/><span style="opacity:.7">${String(f.properties?.level)}</span></div>`)
            .addTo(m);
        });
        m.on("mouseenter", "schools-dot", () => (m.getCanvas().style.cursor = "pointer"));
        m.on("mouseleave", "schools-dot", () => (m.getCanvas().style.cursor = ""));
        map.current = m;
        setReady(true);
      });
    })();
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // ---- layer visibility & commute rings -----------------------------------
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const vis = (on: boolean) => (on ? "visible" : "none");
    for (const id of ["districts-fill", "districts-line", "districts-label", "schools-dot", "schools-label"]) m.setLayoutProperty(id, "visibility", vis(layers.schools));
    for (const id of ["commute-fill", "commute-line", "commute-label"]) m.setLayoutProperty(id, "visibility", vis(layers.commute));
    m.setLayoutProperty("walk-heat", "visibility", vis(layers.walk));
    (m.getSource("commute") as GeoJSONSource).setData(
      featureCollection(
        [...COMMUTE_MINUTES]
          .reverse()
          .map((min) => ({
            type: "Feature" as const,
            properties: { label: `${min} min drive`, color: RING_COLORS[COMMUTE_MINUTES.indexOf(min)] },
            geometry: circlePolygon(anchor.position, driveRadiusKm(min)),
          })),
      ),
    );
    if (layers.commute) m.easeTo({ center: anchor.position, zoom: anchor.id === "portland" || anchor.id === "augusta" ? 8.6 : 10.6, duration: 900 });
  }, [ready, layers, anchor]);

  // ---- price pins ----------------------------------------------------------
  const placeMarkers = useCallback(async () => {
    const m = map.current;
    if (!m) return;
    const maplibregl = await import("maplibre-gl");
    const seen = new Set<string>();
    for (const l of listings) {
      if (l.latitude === null || l.longitude === null) continue;
      seen.add(l.id);
      const label = l.listingType === "rent" ? `${formatPriceCompact(l.priceCents)}/mo` : formatPriceCompact(l.priceCents);
      let marker: Marker | undefined = markers.current.get(l.id);
      if (!marker) {
        const el = document.createElement("button");
        el.type = "button";
        el.setAttribute("aria-label", `${l.title}, ${label}`);
        el.className = "map-pin";
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          setSelected(listings.find((x) => x.id === l.id) ?? l);
        });
        const created = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([l.longitude, l.latitude]).addTo(m);
        markers.current.set(l.id, created);
        marker = created;
      } else {
        marker.setLngLat([l.longitude, l.latitude]);
      }
      const el = marker.getElement();
      el.textContent = label;
      el.dataset.status = l.status;
    }
    for (const [id, marker] of markers.current) {
      if (!seen.has(id)) {
        marker.remove();
        markers.current.delete(id);
      }
    }
  }, [listings]);

  useEffect(() => {
    if (ready) void placeMarkers();
  }, [ready, placeMarkers]);

  useEffect(() => {
    for (const [id, marker] of markers.current) marker.getElement().dataset.selected = String(selected?.id === id);
  }, [selected, listings]);

  useLiveEvents(
    () => {
      api<{ listings: ListingCard[] }>("/api/properties?limit=200")
        .then(({ listings }) => setListings(listings))
        .catch(() => undefined);
    },
    (e) => e.table === "properties" || e.table === "media_assets",
  );

  const selectedFacts = useMemo(() => {
    if (!selected || selected.latitude === null || selected.longitude === null) return null;
    const pos: LngLat = [selected.longitude, selected.latitude];
    return { commute: estimateDriveMinutes(pos, anchor.position), walk: selected.walkScore };
  }, [selected, anchor]);

  return (
    <div className="relative h-[calc(100svh-4rem)] w-full overflow-hidden" data-lenis-prevent>
      <div className="absolute inset-0">
        {/* MapLibre sets position: relative on its container, so it gets a sized wrapper. */}
        <div ref={container} className="size-full" aria-label="Map of listings and neighborhood layers" role="region" />
      </div>

      <div className="material absolute left-4 top-4 z-10 w-[min(320px,calc(100vw-2rem))] rounded-3xl border border-line p-5 text-ink shadow-lg">
        <p className="type-eyebrow text-gold">Layers</p>
        <ul className="mt-4 space-y-4">
          <li className="flex items-center justify-between gap-3">
            <label htmlFor="layer-schools" className="flex items-center gap-2.5 text-sm"><GraduationCap className="size-4 text-pine" aria-hidden /> School districts</label>
            <Switch id="layer-schools" checked={layers.schools} onCheckedChange={(v) => setLayers((s) => ({ ...s, schools: v }))} />
          </li>
          <li>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="layer-commute" className="flex items-center gap-2.5 text-sm"><Car className="size-4 text-pine" aria-hidden /> Commute</label>
              <Switch id="layer-commute" checked={layers.commute} onCheckedChange={(v) => setLayers((s) => ({ ...s, commute: v }))} />
            </div>
            <AnimatePresence initial={false}>
              {layers.commute && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <label htmlFor="commute-to" className="sr-only">Commute destination</label>
                  <Select id="commute-to" value={anchorId} onChange={(e) => setAnchorId(e.target.value)} className="mt-3 h-10 text-sm">
                    {COMMUTE_ANCHORS.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </Select>
                  <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[0.75rem] text-ink-2">
                    {COMMUTE_MINUTES.map((min, i) => (
                      <li key={min} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: RING_COLORS[i] }} />{min} min</li>
                    ))}
                  </ul>
                </motion.div>
              )}
            </AnimatePresence>
          </li>
          <li className="flex items-center justify-between gap-3">
            <label htmlFor="layer-walk" className="flex items-center gap-2.5 text-sm"><Footprints className="size-4 text-pine" aria-hidden /> Walkability</label>
            <Switch id="layer-walk" checked={layers.walk} onCheckedChange={(v) => setLayers((s) => ({ ...s, walk: v }))} />
          </li>
        </ul>
        <p className="mt-5 border-t border-line pt-4 text-[0.75rem] leading-relaxed text-ink-3">
          District areas are approximate — confirm enrollment with the district. Commute rings and Walk Index are estimates, not live traffic or Walk Score®.
        </p>
      </div>

      <AnimatePresence>
        {selected && (
          <motion.aside
            key={selected.id}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 30 }}
            transition={{ type: "spring", bounce: 0, duration: 0.45 }}
            className="absolute bottom-4 left-4 right-4 z-10 overflow-hidden rounded-[28px] bg-paper text-ink shadow-lg ring-1 ring-line sm:left-auto sm:right-20 sm:w-[380px]"
            aria-label={`${selected.title} preview`}
          >
            <Link href={`/listings/${selected.slug}`} className="block">
              <ListingImage image={selected.cover} alt={selected.title} sizes="380px" className="aspect-[16/9] w-full" />
              <div className="p-5">
                <p className="type-eyebrow text-ink-3">{selected.city}, {selected.state}</p>
                <p className="type-headline mt-1">{selected.title}</p>
                <p className="mt-2 text-sm text-ink-2">
                  <span className="tabular font-medium text-ink">{selected.listingType === "rent" ? formatRent(selected.priceCents) : formatPrice(selected.priceCents)}</span>
                  {" · "}{selected.bedrooms} bd · {formatBaths(selected.fullBaths, selected.halfBaths)} ba
                </p>
                {selectedFacts && (
                  <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4 text-[0.75rem]">
                    <div><dt className="text-ink-3">District</dt><dd className="mt-0.5 font-medium">{selected.schoolDistrict?.split(" (")[0] ?? "—"}</dd></div>
                    <div><dt className="text-ink-3">To {anchor.name.split(" (")[0].split(",")[0]}</dt><dd className="mt-0.5 font-medium">~{selectedFacts.commute} min</dd></div>
                    <div><dt className="text-ink-3">Walk Index</dt><dd className="mt-0.5 font-medium">{selectedFacts.walk ?? "—"}{selectedFacts.walk !== null ? ` · ${walkIndexLabel(selectedFacts.walk)}` : ""}</dd></div>
                  </dl>
                )}
                <p className="mt-4 text-sm font-medium underline underline-offset-4">View the residence →</p>
              </div>
            </Link>
            <button type="button" onClick={() => setSelected(null)} className="pressable material absolute right-3 top-3 grid size-9 place-items-center rounded-full" aria-label="Close preview">
              <X className="size-4" />
            </button>
          </motion.aside>
        )}
      </AnimatePresence>

      <style>{`
        .map-pin { font: 600 12px/1 var(--font-sans); letter-spacing: -0.01em; padding: 8px 11px; border-radius: 999px;
          background: var(--ink); color: var(--paper); box-shadow: 0 6px 20px rgb(0 0 0 / .25); cursor: pointer;
          transition: transform .2s cubic-bezier(.16,1,.3,1), background-color .2s; }
        .map-pin:hover, .map-pin[data-selected="true"] { transform: scale(1.12); background: var(--gold); color: #fff; z-index: 5; }
        .map-pin[data-status="pending"] { background: #6b5f4d; }
        .map-pin[data-status="sold"] { background: #8c8579; text-decoration: line-through; }
      `}</style>
      <span className={cn("sr-only")} aria-live="polite">{selected ? `Selected ${selected.title}` : ""}</span>
    </div>
  );
}
