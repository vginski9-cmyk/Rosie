"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { MapPoint } from "@/lib/queries";

// A Leaflet map (bundled with the app, tiles from OpenStreetMap) of every place an offering runs:
// campuses in rose, clinical sites in sky. The list beside it is the same data, clickable.
import "leaflet/dist/leaflet.css";
type LMap = import("leaflet").Map;
type LMarker = import("leaflet").CircleMarker;
const loadLeaflet = () => import("leaflet");

const COLOR = { campus: "#e11d48", site: "#0284c7" } as const;

export function OfferingsMap({ points }: { points: MapPoint[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const markers = useRef(new Map<string, LMarker>());
  const [failed, setFailed] = useState(false);
  const [kinds, setKinds] = useState<Set<string>>(new Set(["campus", "site"]));
  const shown = useMemo(() => points.filter((p) => kinds.has(p.kind)), [points, kinds]);
  const totals = useMemo(() => ({ offerings: new Set(points.flatMap((p) => p.offerings.map((o) => o.cohortId))).size, campuses: points.filter((p) => p.kind === "campus").length, sites: points.filter((p) => p.kind === "site").length }), [points]);

  useEffect(() => {
    let dead = false;
    loadLeaflet().then((L) => {
      if (dead || !ref.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(ref.current, { scrollWheelZoom: false });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 18 }).addTo(mapRef.current);
      }
      const map = mapRef.current;
      for (const m of markers.current.values()) m.remove();
      markers.current.clear();
      for (const p of shown) {
        const n = p.offerings.length;
        const m = L.circleMarker([p.lat, p.lng], { radius: Math.min(22, 7 + 2.2 * Math.sqrt(n)), color: "#fff", weight: 1.5, fillColor: COLOR[p.kind], fillOpacity: 0.85 }).addTo(map);
        const rows = p.offerings.slice(0, 12).map((o) => `<div style="display:flex;gap:6px;justify-content:space-between"><a href="/programs/${o.programId}/offerings/${o.cohortId}" style="color:#be123c">${esc(o.cohort)}</a><span style="color:#64748b">${esc(o.program)} · ${o.status}</span></div>`).join("");
        m.bindPopup(`<div style="font:12px system-ui;min-width:220px"><strong>${esc(p.name)}</strong><div style="color:#64748b">${esc(p.institution)}${p.city ? ` · ${esc(p.city)}` : ""} · ${n} offering${n === 1 ? "" : "s"}</div><div style="margin-top:6px;display:grid;gap:2px">${rows}${p.offerings.length > 12 ? `<div style="color:#94a3b8">+${p.offerings.length - 12} more</div>` : ""}</div></div>`);
        markers.current.set(p.id, m);
      }
      if (shown.length) map.fitBounds(L.latLngBounds(shown.map((p) => [p.lat, p.lng] as [number, number])).pad(0.25), { maxZoom: 11 });
      else map.setView([35.3, -78.5], 7);
    }).catch(() => { if (!dead) setFailed(true); });
    return () => { dead = true; };
  }, [shown]);
  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null; }, []);

  const focus = (id: string) => { const m = markers.current.get(id); if (m && mapRef.current) { mapRef.current.setView(m.getLatLng(), Math.max(mapRef.current.getZoom(), 11)); m.openPopup(); } };
  const byInst = useMemo(() => { const m = new Map<string, MapPoint[]>(); for (const p of shown) m.set(p.institution, [...(m.get(p.institution) ?? []), p]); return [...m.entries()]; }, [shown]);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
          <span><strong className="text-slate-800">{totals.offerings}</strong> offerings · <strong className="text-slate-800">{totals.campuses}</strong> campuses · <strong className="text-slate-800">{totals.sites}</strong> clinical sites</span>
          {(["campus", "site"] as const).map((k) => (
            <label key={k} className="inline-flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={kinds.has(k)} onChange={(e) => setKinds((s) => { const n = new Set(s); e.target.checked ? n.add(k) : n.delete(k); return n; })} className="accent-rose-600" /><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLOR[k] }} />{k === "campus" ? "campuses (class & lab)" : "clinical sites (booked shifts)"}</label>
          ))}
        </div>
        <div ref={ref} className="h-[520px] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100" />
        {failed && <p className="text-sm text-rose-700">The map could not be drawn here. The list on the right is the same data.</p>}
      </div>
      <div className="max-h-[560px] space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3">
        {byInst.map(([inst, ps]) => (
          <div key={inst}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{inst}</div>
            {ps.map((p) => (
              <button key={p.id} onClick={() => focus(p.id)} className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50">
                <span className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLOR[p.kind] }} />
                <span className="min-w-0">
                  <span className="block font-medium text-slate-800">{p.name}{p.city ? <span className="font-normal text-slate-400"> · {p.city}</span> : null}</span>
                  <span className="block text-[11px] text-slate-500">{p.offerings.length} offering{p.offerings.length === 1 ? "" : "s"}: {p.offerings.slice(0, 4).map((o) => o.cohort).join(", ")}{p.offerings.length > 4 ? ", …" : ""}</span>
                </span>
              </button>
            ))}
          </div>
        ))}
        {shown.length === 0 && <p className="text-sm text-slate-400">Nothing to place yet.</p>}
        <p className="pt-2 text-[11px] text-slate-400">Offerings not yet calendarized sit at their college&apos;s main campus. <Link href="/calendar" className="text-rose-600 hover:underline">Calendar →</Link></p>
      </div>
    </div>
  );
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
