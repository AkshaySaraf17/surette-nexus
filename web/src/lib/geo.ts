/**
 * Local context for the Waterville, Maine market: schools, everyday
 * destinations and commute anchors used by the map layers, the walkability
 * estimate and the concierge.
 *
 * Honesty notes (also shown in the map legend):
 *  - Coordinates are approximate (street level), compiled for this site.
 *  - District areas are drawn as approximate circles around each town, not
 *    official boundaries; families should confirm with the district.
 *  - "Walk Index" is our own 0–100 estimate from distance to everyday
 *    destinations. It is not a Walk Score® rating.
 *  - Commute times are estimates from straight-line distance and typical
 *    regional road speeds, not live traffic.
 */

export type LngLat = [number, number];

export interface School {
  name: string;
  level: "Elementary" | "Middle" | "High" | "College";
  district: string;
  position: LngLat;
}

export interface District {
  id: string;
  name: string;
  towns: string;
  color: string;
  center: LngLat;
  radiusKm: number;
}

export const DISTRICTS: District[] = [
  { id: "aos92-waterville", name: "Waterville Public Schools (AOS 92)", towns: "Waterville", color: "#8a6d3b", center: [-69.646, 44.548], radiusKm: 4.2 },
  { id: "aos92-winslow", name: "Winslow Public Schools (AOS 92)", towns: "Winslow", color: "#3b6d8a", center: [-69.6, 44.545], radiusKm: 4.6 },
  { id: "rsu18", name: "RSU 18 – Messalonskee", towns: "Oakland, Belgrade, Rome, Sidney, China", color: "#5a7a4a", center: [-69.73, 44.54], radiusKm: 7.5 },
  { id: "msad49", name: "MSAD 49 – Lawrence", towns: "Fairfield, Benton, Clinton, Albion", color: "#7a4a6a", center: [-69.6, 44.59], radiusKm: 5.5 },
];

export const SCHOOLS: School[] = [
  { name: "George J. Mitchell School", level: "Elementary", district: "aos92-waterville", position: [-69.6497, 44.5386] },
  { name: "Albert S. Hall School", level: "Elementary", district: "aos92-waterville", position: [-69.6421, 44.5547] },
  { name: "Waterville Junior High School", level: "Middle", district: "aos92-waterville", position: [-69.6595, 44.5407] },
  { name: "Waterville Senior High School", level: "High", district: "aos92-waterville", position: [-69.6576, 44.5418] },
  { name: "Winslow Elementary School", level: "Elementary", district: "aos92-winslow", position: [-69.6125, 44.5389] },
  { name: "Winslow Junior High School", level: "Middle", district: "aos92-winslow", position: [-69.6152, 44.5363] },
  { name: "Winslow High School", level: "High", district: "aos92-winslow", position: [-69.6138, 44.5372] },
  { name: "Messalonskee High School", level: "High", district: "rsu18", position: [-69.7206, 44.5468] },
  { name: "Messalonskee Middle School", level: "Middle", district: "rsu18", position: [-69.7181, 44.5486] },
  { name: "Atwood Primary School", level: "Elementary", district: "rsu18", position: [-69.7203, 44.5432] },
  { name: "Lawrence High School", level: "High", district: "msad49", position: [-69.5986, 44.5939] },
  { name: "Colby College", level: "College", district: "aos92-waterville", position: [-69.6626, 44.5638] },
  { name: "Thomas College", level: "College", district: "aos92-waterville", position: [-69.6687, 44.5267] },
];

export interface CommuteAnchor {
  id: string;
  name: string;
  position: LngLat;
}

export const COMMUTE_ANCHORS: CommuteAnchor[] = [
  { id: "downtown", name: "Downtown Waterville (Main St)", position: [-69.6317, 44.552] },
  { id: "colby", name: "Colby College", position: [-69.6626, 44.5638] },
  { id: "hospital", name: "MaineGeneral Thayer Center", position: [-69.6382, 44.5571] },
  { id: "augusta", name: "Maine State House, Augusta", position: [-69.7817, 44.3072] },
  { id: "portland", name: "Portland (Monument Square)", position: [-70.2588, 43.6583] },
];

/** Everyday destinations that drive the Walk Index and the walkability heat layer. Weight = importance. */
export const AMENITIES: { name: string; kind: string; position: LngLat; weight: number }[] = [
  { name: "Main Street shops & restaurants", kind: "Dining", position: [-69.6317, 44.552], weight: 1 },
  { name: "Castonguay Square", kind: "Park", position: [-69.6331, 44.5516], weight: 0.7 },
  { name: "Paul J. Schupf Art Center", kind: "Culture", position: [-69.6322, 44.5507], weight: 0.6 },
  { name: "Waterville Public Library", kind: "Culture", position: [-69.6345, 44.5506], weight: 0.6 },
  { name: "Head of Falls / RiverWalk", kind: "Park", position: [-69.6286, 44.5527], weight: 0.8 },
  { name: "Two Cent Bridge", kind: "Park", position: [-69.6275, 44.5535], weight: 0.5 },
  { name: "Elm Plaza groceries", kind: "Grocery", position: [-69.6411, 44.5427], weight: 1 },
  { name: "Hannaford (Kennedy Memorial Dr)", kind: "Grocery", position: [-69.6603, 44.5392], weight: 1 },
  { name: "Colby College Museum of Art", kind: "Culture", position: [-69.6619, 44.5642], weight: 0.6 },
  { name: "Quarry Road Trails", kind: "Park", position: [-69.6153, 44.5714], weight: 0.6 },
  { name: "Pine Ridge Golf Course", kind: "Recreation", position: [-69.6668, 44.5543], weight: 0.3 },
  { name: "Winslow Town Center", kind: "Dining", position: [-69.6206, 44.5428], weight: 0.6 },
  { name: "Fort Halifax Park", kind: "Park", position: [-69.6222, 44.5378], weight: 0.5 },
  { name: "Oakland Main Street", kind: "Dining", position: [-69.7212, 44.5408], weight: 0.6 },
  { name: "Messalonskee Lake landing", kind: "Recreation", position: [-69.7314, 44.5488], weight: 0.4 },
  { name: "Fairfield Main Street", kind: "Dining", position: [-69.5989, 44.5884], weight: 0.5 },
];

const EARTH_KM = 6371;

/** Great-circle distance in kilometres. */
export function distanceKm(a: LngLat, b: LngLat): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

/**
 * Walk Index (0–100): each destination contributes its weight scaled by a
 * walking-distance decay (full value within 400 m, nothing beyond ~2.4 km).
 */
export function walkIndex(position: LngLat): number {
  let score = 0;
  for (const amenity of AMENITIES) {
    const km = distanceKm(position, amenity.position);
    const decay = km <= 0.4 ? 1 : km >= 2.4 ? 0 : 1 - (km - 0.4) / 2;
    score += amenity.weight * decay;
  }
  // ~6 weighted destinations in easy reach is "walker's paradise" territory.
  return Math.max(0, Math.min(100, Math.round((score / 6) * 100)));
}

export function walkIndexLabel(score: number): string {
  if (score >= 85) return "Walker's paradise";
  if (score >= 65) return "Very walkable";
  if (score >= 45) return "Somewhat walkable";
  if (score >= 20) return "Car-friendly";
  return "Car-dependent";
}

/**
 * Estimated drive time in minutes: straight-line distance × 1.3 road-winding
 * factor at ~30 mph in town and ~55 mph beyond 15 km, plus 3 minutes to park.
 */
export function estimateDriveMinutes(from: LngLat, to: LngLat): number {
  const roadKm = distanceKm(from, to) * 1.3;
  const townKm = Math.min(roadKm, 15);
  const highwayKm = Math.max(roadKm - 15, 0);
  const minutes = (townKm / 48.3) * 60 + (highwayKm / 88.5) * 60 + 3;
  return Math.max(3, Math.round(minutes));
}

/** Radius (km, straight-line) reachable within `minutes` of driving — inverse of estimateDriveMinutes. */
export function driveRadiusKm(minutes: number): number {
  const usable = Math.max(minutes - 3, 0);
  const townMinutes = (15 / 48.3) * 60;
  const roadKm = usable <= townMinutes ? (usable / 60) * 48.3 : 15 + ((usable - townMinutes) / 60) * 88.5;
  return roadKm / 1.3;
}

/** A GeoJSON polygon approximating a circle (for district areas and commute rings). */
export function circlePolygon(center: LngLat, radiusKm: number, steps = 72): GeoJSON.Polygon {
  const [lng, lat] = center;
  const coords: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const dLat = (radiusKm / EARTH_KM) * (180 / Math.PI) * Math.sin(angle);
    const dLng = ((radiusKm / EARTH_KM) * (180 / Math.PI) * Math.cos(angle)) / Math.cos((lat * Math.PI) / 180);
    coords.push([lng + dLng, lat + dLat]);
  }
  return { type: "Polygon", coordinates: [coords] };
}

/** The district whose area contains the point (nearest centre wins on overlap). */
export function districtFor(position: LngLat): District | null {
  let best: { d: District; km: number } | null = null;
  for (const d of DISTRICTS) {
    const km = distanceKm(position, d.center);
    if (km <= d.radiusKm && (!best || km < best.km)) best = { d, km };
  }
  return best?.d ?? null;
}

export const MAP_CENTER: LngLat = [-69.655, 44.552];
