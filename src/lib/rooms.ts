// Rooms — structured open hours (per weekday spans + dated closures) and the
// availability / utilization math built on them. Pure functions.

import type { Weekday } from "./clinicalsupply";
import { weekdayOfIso } from "./clinicalsupply";

export interface HoursSpan { dayOfWeek: string; openTime: string; closeTime: string }
export interface Closure { date: string; openTime: string | null; closeTime: string | null; note?: string | null }

export const WEEKDAYS: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
export const spanHours = (open: string, close: string) => Math.max(0, (toMin(close) - toMin(open)) / 60);

/** Hours presets a room can be set to in one click. */
export const HOURS_PRESETS: { key: string; label: string; spans: HoursSpan[] }[] = [
  { key: "weekday-business", label: "Mon–Fri 8:00–17:00", spans: WEEKDAYS.slice(0, 5).map((d) => ({ dayOfWeek: d, openTime: "08:00", closeTime: "17:00" })) },
  { key: "weekday-extended", label: "Mon–Fri 7:30–21:30", spans: WEEKDAYS.slice(0, 5).map((d) => ({ dayOfWeek: d, openTime: "07:30", closeTime: "21:30" })) },
  { key: "weekday-extended-sat", label: "Mon–Fri 7:30–21:30 · Sat 8:00–14:00", spans: [...WEEKDAYS.slice(0, 5).map((d) => ({ dayOfWeek: d, openTime: "07:30", closeTime: "21:30" })), { dayOfWeek: "Sat", openTime: "08:00", closeTime: "14:00" }] },
  { key: "seven-day", label: "Every day 7:00–22:00", spans: WEEKDAYS.map((d) => ({ dayOfWeek: d, openTime: "07:00", closeTime: "22:00" })) },
  { key: "always", label: "24 × 7", spans: WEEKDAYS.map((d) => ({ dayOfWeek: d, openTime: "00:00", closeTime: "24:00" })) },
];

/** Open hours on one date (closures win). */
export function openHoursOn(spans: HoursSpan[], closures: Closure[], iso: string): number {
  const c = closures.find((x) => x.date === iso);
  if (c) return c.openTime && c.closeTime ? spanHours(c.openTime, c.closeTime) : 0;
  const wd = weekdayOfIso(iso);
  return spans.filter((s) => s.dayOfWeek === wd).reduce((n, s) => n + spanHours(s.openTime, s.closeTime), 0);
}

/** Weekly open hours from the spans. */
export const weeklyOpenHours = (spans: HoursSpan[]) => spans.reduce((n, s) => n + spanHours(s.openTime, s.closeTime), 0);

/** Compact label: "Mon–Fri 7:30–21:30 · Sat 8:00–14:00". */
export function hoursLabel(spans: HoursSpan[]): string {
  if (!spans.length) return "no hours set";
  const byDay = new Map<string, string>();
  for (const d of WEEKDAYS) { const s = spans.filter((x) => x.dayOfWeek === d).sort((a, b) => a.openTime.localeCompare(b.openTime)); if (s.length) byDay.set(d, s.map((x) => `${x.openTime}–${x.closeTime}`).join(" & ")); }
  const groups: { days: string[]; hours: string }[] = [];
  for (const d of WEEKDAYS) { const h = byDay.get(d); if (!h) continue; const g = groups[groups.length - 1]; if (g && g.hours === h && WEEKDAYS.indexOf(g.days[g.days.length - 1] as Weekday) === WEEKDAYS.indexOf(d) - 1) g.days.push(d); else groups.push({ days: [d], hours: h }); }
  return groups.map((g) => `${g.days.length > 2 ? `${g.days[0]}–${g.days[g.days.length - 1]}` : g.days.join(", ")} ${g.hours}`).join(" · ");
}

/** Whether a meeting (weekday, start "HH:MM", length h) falls inside the room's open hours. */
export function withinHours(spans: HoursSpan[], dayOfWeek: string, startTime: string, lengthHours: number): boolean {
  const s = toMin(startTime), e = s + Math.round(lengthHours * 60);
  return spans.some((x) => x.dayOfWeek === dayOfWeek && toMin(x.openTime) <= s && toMin(x.closeTime) >= e);
}

/** Weekly utilization: booked meeting hours in the room ÷ weekly open hours. */
export function weeklyUtilization(spans: HoursSpan[], meetings: { dayOfWeek: string; startTime: string; lengthHours: number }[]): { open: number; booked: number; utilization: number; outsideHours: number } {
  const open = weeklyOpenHours(spans);
  const booked = meetings.reduce((n, m) => n + m.lengthHours, 0);
  const outsideHours = meetings.filter((m) => !withinHours(spans, m.dayOfWeek, m.startTime, m.lengthHours)).length;
  return { open, booked, utilization: open > 0 ? booked / open : 0, outsideHours };
}

/** Parse legacy free-text hours like "Mon–Fri 7:30a–9:30p · Sat 8a–2p" into spans (best effort). */
export function parseHoursText(text: string | null | undefined): HoursSpan[] {
  if (!text) return [];
  const out: HoursSpan[] = [];
  const dayIdx = (d: string) => WEEKDAYS.findIndex((w) => w.toLowerCase() === d.slice(0, 3).toLowerCase());
  const t24 = (s: string) => { const m = /^(\d{1,2})(?::(\d{2}))?\s*(a|p|am|pm)?$/i.exec(s.trim()); if (!m) return null; let h = Number(m[1]); const mm = Number(m[2] ?? 0); const ap = (m[3] ?? "").toLowerCase(); if (ap.startsWith("p") && h < 12) h += 12; if (ap.startsWith("a") && h === 12) h = 0; return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`; };
  for (const part of text.split(/[·;,]+/)) {
    const m = /([A-Za-z]{3})[a-z]*\s*(?:[–-]\s*([A-Za-z]{3})[a-z]*)?\s+(\d{1,2}(?::\d{2})?\s*(?:a|p|am|pm)?)\s*[–-]\s*(\d{1,2}(?::\d{2})?\s*(?:a|p|am|pm)?)/i.exec(part);
    if (!m) continue;
    const a = dayIdx(m[1]), b = m[2] ? dayIdx(m[2]) : a; const o = t24(m[3]), c = t24(m[4]);
    if (a < 0 || b < 0 || !o || !c) continue;
    for (let i = a; i <= b; i++) out.push({ dayOfWeek: WEEKDAYS[i], openTime: o, closeTime: c });
  }
  return out;
}

/** Equipment vocabularies. */
export const EQUIPMENT_CATEGORIES = ["Imaging", "Simulation", "Medical device", "Lab bench", "Sterile processing", "AV / IT", "Computing", "Furniture", "Safety", "Other"] as const;
export const MOBILITY = [{ key: "fixed", label: "Fixed — installed in its room" }, { key: "mobile", label: "Mobile — moves between rooms" }, { key: "portable", label: "Portable — goes anywhere" }] as const;
