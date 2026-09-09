// Where clinical sites are, and how far they are from the campus that delivers
// the program — auto-coded from addresses.
//
// A site's ring (Core / Ring 1 / Ring 2 / Ring 3) is not typed in: it falls out of
// the estimated drive time from the institution's main campus under the
// institution's own bands (default 30 / 60 / 90 minutes). Coordinates come from
// the US Census Bureau geocoder when the server can reach it (free, no key), and
// from a built-in gazetteer of North Carolina place centroids when it cannot —
// the source is stored with the coordinates so a coordinator knows which. Drive
// time is an estimate from straight-line distance with a road-detour factor and
// rural / regional speeds; a manual ring override always wins.

export interface LatLng { lat: number; lng: number }
export type GeoSource = "census" | "gazetteer" | "manual";
export interface Located extends LatLng { source: GeoSource; label: string }
export interface RingBands { coreMinutes: number; oneMinutes: number; twoMinutes: number }
export const DEFAULT_BANDS: RingBands = { coreMinutes: 30, oneMinutes: 60, twoMinutes: 90 };
export type Ring = "Core" | "Ring 1" | "Ring 2" | "Ring 3";

const R_MILES = 3958.7613;
const rad = (d: number) => (d * Math.PI) / 180;
/** Great-circle distance in statute miles. */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.sqrt(h));
}
/** Road miles ≈ straight-line × 1.25 (typical detour factor for the rural Piedmont / Sandhills road net). */
export const ROAD_FACTOR = 1.25;
/** Drive-time estimate: short hops on town streets, mid-range on two-lane state routes, long runs on US highways. */
export function driveMinutes(straightMiles: number): number {
  const road = straightMiles * ROAD_FACTOR;
  const mph = road <= 8 ? 28 : road <= 30 ? 40 : road <= 60 ? 48 : 55;
  return (road / mph) * 60 + 4; // + parking / walk-in
}
export function ringOf(minutes: number, bands: RingBands = DEFAULT_BANDS): Ring {
  if (minutes <= bands.coreMinutes) return "Core";
  if (minutes <= bands.oneMinutes) return "Ring 1";
  if (minutes <= bands.twoMinutes) return "Ring 2";
  return "Ring 3";
}
/** When both ends resolve to the same town centroid (gazetteer), the straight-line distance collapses to
 *  zero — which is not a drive. Two points in the same NC town are typically a couple of miles apart, so
 *  that is the floor used for banding; the source stored with the coordinates says it is a centroid. */
export const SAME_TOWN_MILES = 2;
/** Distance, drive time and ring from a campus to a site. Pass the sources to apply the same-town floor. */
export function distanceFrom(campus: LatLng & { source?: GeoSource | null }, site: LatLng & { source?: GeoSource | null }, bands: RingBands = DEFAULT_BANDS): { miles: number; minutes: number; ring: Ring; sameTown: boolean } {
  let miles = haversineMiles(campus, site);
  const centroid = campus.source === "gazetteer" || site.source === "gazetteer";
  const sameTown = centroid && miles < 0.5;
  if (sameTown) miles = SAME_TOWN_MILES;
  const minutes = driveMinutes(miles);
  return { miles, minutes, ring: ringOf(minutes, bands), sameTown };
}

/** Built-in gazetteer — North Carolina place centroids (city, state) used when no geocoder is reachable.
 *  Town-centre accuracy (a mile or two), which is enough to band a drive time; the stored source says so. */
export const NC_PLACES: Record<string, LatLng> = {
  "pinehurst": { lat: 35.1954, lng: -79.4695 }, "southern pines": { lat: 35.1740, lng: -79.3922 }, "aberdeen": { lat: 35.1315, lng: -79.4292 }, "carthage": { lat: 35.3460, lng: -79.4170 },
  "robbins": { lat: 35.4335, lng: -79.5870 }, "vass": { lat: 35.2543, lng: -79.2820 }, "west end": { lat: 35.2510, lng: -79.5160 }, "whispering pines": { lat: 35.2540, lng: -79.3710 }, "seven lakes": { lat: 35.2620, lng: -79.5710 },
  "sanford": { lat: 35.4799, lng: -79.1803 }, "fayetteville": { lat: 35.0527, lng: -78.8784 }, "hope mills": { lat: 34.9704, lng: -78.9453 }, "spring lake": { lat: 35.1679, lng: -78.9781 }, "fort liberty": { lat: 35.1400, lng: -79.0060 }, "fort bragg": { lat: 35.1400, lng: -79.0060 },
  "eastover": { lat: 35.0960, lng: -78.7930 }, "falcon": { lat: 35.1900, lng: -78.6480 }, "raeford": { lat: 34.9779, lng: -79.2242 }, "rockingham": { lat: 34.9393, lng: -79.7739 }, "hamlet": { lat: 34.8846, lng: -79.6942 },
  "laurinburg": { lat: 34.7740, lng: -79.4625 }, "lillington": { lat: 35.3993, lng: -78.8156 }, "dunn": { lat: 35.3063, lng: -78.6089 }, "asheboro": { lat: 35.7079, lng: -79.8136 }, "archdale": { lat: 35.9146, lng: -79.9720 },
  "ramseur": { lat: 35.7332, lng: -79.6525 }, "trinity": { lat: 35.8951, lng: -79.9905 }, "troy": { lat: 35.3579, lng: -79.8942 }, "biscoe": { lat: 35.3596, lng: -79.7792 }, "wadesboro": { lat: 34.9682, lng: -80.0767 },
  "siler city": { lat: 35.7235, lng: -79.4622 }, "pittsboro": { lat: 35.7201, lng: -79.1772 }, "chapel hill": { lat: 35.9132, lng: -79.0558 }, "lumberton": { lat: 34.6182, lng: -79.0086 }, "pembroke": { lat: 34.6802, lng: -79.1950 },
  "elizabethtown": { lat: 34.6293, lng: -78.6053 }, "clinton": { lat: 35.0002, lng: -78.3236 }, "goldsboro": { lat: 35.3849, lng: -77.9928 }, "greensboro": { lat: 36.0726, lng: -79.7920 }, "raleigh": { lat: 35.7796, lng: -78.6382 },
  "durham": { lat: 35.9940, lng: -78.8986 }, "charlotte": { lat: 35.2271, lng: -80.8431 }, "wilmington": { lat: 34.2257, lng: -77.9447 }, "morehead city": { lat: 34.7229, lng: -76.7260 }, "kinston": { lat: 35.2627, lng: -77.5816 },
  "new bern": { lat: 35.1085, lng: -77.0441 }, "elizabeth city": { lat: 36.2946, lng: -76.2510 }, "jacksonville": { lat: 34.7541, lng: -77.4302 }, "rocky mount": { lat: 35.9382, lng: -77.7905 }, "winston-salem": { lat: 36.0999, lng: -80.2442 },
  "salisbury": { lat: 35.6710, lng: -80.4742 }, "thomasville": { lat: 35.8826, lng: -80.0820 }, "washington": { lat: 35.5466, lng: -77.0522 }, "whiteville": { lat: 34.3388, lng: -78.7031 }, "bolivia": { lat: 34.0687, lng: -78.1481 },
  "kenansville": { lat: 34.9624, lng: -77.9622 }, "ahoskie": { lat: 36.2868, lng: -76.9847 }, "winterville": { lat: 35.5290, lng: -77.4011 }, "greenville": { lat: 35.6127, lng: -77.3663 }, "cary": { lat: 35.7915, lng: -78.7811 },
  "high point": { lat: 35.9557, lng: -80.0053 }, "burlington": { lat: 36.0957, lng: -79.4378 }, "concord": { lat: 35.4088, lng: -80.5795 }, "monroe": { lat: 34.9854, lng: -80.5495 }, "albemarle": { lat: 35.3501, lng: -80.2001 },
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z\- ]/g, "").replace(/\s+/g, " ").trim();
/** Offline: a place centroid for a city (NC), else null. */
export function geocodeOffline(parts: { city?: string | null; state?: string | null }): Located | null {
  if (!parts.city) return null;
  if (parts.state && parts.state.toUpperCase() !== "NC") return null;
  const hit = NC_PLACES[norm(parts.city)];
  return hit ? { ...hit, source: "gazetteer", label: `${parts.city} centroid (built-in gazetteer)` } : null;
}
/** Online: the US Census Bureau geocoder (free, no key). Null when unreachable, ambiguous or unmatched. */
export async function geocodeOnline(parts: { address?: string | null; city?: string | null; state?: string | null; zip?: string | null }, timeoutMs = 6000): Promise<Located | null> {
  const line = [parts.address, parts.city, parts.state, parts.zip].filter(Boolean).join(", ");
  if (!parts.address || !parts.city) return null;
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(line)}&benchmark=Public_AR_Current&format=json`;
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "rosie-program-planning" } });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: { addressMatches?: { coordinates: { x: number; y: number }; matchedAddress: string }[] } };
    const m = data.result?.addressMatches?.[0];
    return m ? { lat: m.coordinates.y, lng: m.coordinates.x, source: "census", label: m.matchedAddress } : null;
  } catch { return null; }
}
/** Online first, gazetteer second. */
export async function locate(parts: { address?: string | null; city?: string | null; state?: string | null; zip?: string | null }, online = true): Promise<Located | null> {
  return (online ? await geocodeOnline(parts) : null) ?? geocodeOffline(parts);
}
