"use client";

// The institution's academic calendar — imported, not typed. Paste the college's
// calendar (web page text, text copied from the PDF, cells from Excel) or drop
// the spreadsheet / CSV; every dated line is coded live (semester starts, ends,
// later sessions, holidays & breaks), you fix anything mis-coded, save. The
// term-date engine then follows the exact coded starts and every session that
// lands on a break is flagged.

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Collapse } from "@/components/Collapse";
import { parseAcademicCalendar, anchorsFromEvents, KIND_LABEL, type CalendarEvent, type EventKind, type Season } from "@/lib/academiccalendar";
import { importAcademicCalendar, deleteAcademicEvent, clearAcademicCalendar, updateInstitutionCalendar } from "@/lib/actions";

export interface CodedEvent { id: string; iso: string; endIso: string | null; label: string; kind: string; season: string | null }

const fmt = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const fmtShort = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtMMDD = (mmdd: string) => new Date(`2001-${mmdd}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
const span = (e: { iso: string; endIso: string | null }) => (e.endIso ? `${fmt(e.iso)} – ${fmtShort(e.endIso)}` : fmt(e.iso));

const KINDS: EventKind[] = ["term_start", "term_end", "session_start", "holiday", "other"];
const SEASONS: Season[] = ["Spring", "Summer", "Fall"];
const KIND_TONE: Record<string, string> = {
  term_start: "bg-emerald-100 text-emerald-800", term_end: "bg-slate-200 text-slate-700",
  session_start: "bg-sky-100 text-sky-800", holiday: "bg-rose-100 text-rose-800", other: "bg-slate-100 text-slate-400",
};

const PLACEHOLDER = `Paste the academic calendar here — from the college website, a PDF, or Excel. For example:

Fall 2026
Classes begin — Monday, August 17, 2026
Labor Day Holiday (College Closed) — September 7, 2026
Thanksgiving Break — November 25–27, 2026
Last day of classes — December 15, 2026
Spring 2027
Classes begin — January 11, 2027
Spring Break — March 8–12, 2027
…`;

export function AcademicCalendar({ institutionId, institutionName, familyId, anchors, coded }: {
  institutionId: string;
  institutionName: string;
  familyId: string;
  anchors: { springStart: string; summerStart: string; fallStart: string };
  coded: CodedEvent[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<number, Partial<Pick<CalendarEvent, "kind" | "season">>>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseAcademicCalendar(text), [text]);
  const events: CalendarEvent[] = useMemo(() => parsed.events.map((e, i) => ({ ...e, ...(edits[i] ?? {}) })), [parsed, edits]);
  const nextAnchors = useMemo(() => anchorsFromEvents(events, anchors), [events, anchors]);
  const keep = events.filter((e) => e.kind !== "other");
  const counts = (list: { kind: string }[]) => ({
    starts: list.filter((e) => e.kind === "term_start").length,
    ends: list.filter((e) => e.kind === "term_end").length,
    sessions: list.filter((e) => e.kind === "session_start").length,
    breaks: list.filter((e) => e.kind === "holiday").length,
  });
  const c = counts(keep);
  const codedCounts = counts(coded);
  const codedYears = [...new Set(coded.map((e) => e.iso.slice(0, 4)))].sort();
  const importYears = [...new Set(keep.map((e) => e.iso.slice(0, 4)))].sort();

  /** Drop / choose a spreadsheet or text file: every sheet's cells become pasted lines. */
  const readFile = async (f: File) => {
    const name = f.name.toLowerCase();
    if (/\.(xlsx|xlsm|xls|csv|tsv)$/.test(name)) {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true });
      const lines: string[] = [];
      for (const sn of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sn], { header: 1, raw: false, dateNF: "m/d/yyyy" });
        lines.push(sn);
        for (const r of rows) { const cells = (r ?? []).map((v) => (v == null ? "" : String(v)).trim()).filter(Boolean); if (cells.length) lines.push(cells.join("\t")); }
      }
      setText(lines.join("\n"));
      setFileNote(`${f.name} — ${wb.SheetNames.length} sheet${wb.SheetNames.length === 1 ? "" : "s"} read`);
    } else {
      setText(await f.text());
      setFileNote(`${f.name} read`);
    }
    setEdits({});
  };

  const save = () => startTransition(async () => {
    const res = await importAcademicCalendar(institutionId, familyId, {
      anchors: nextAnchors,
      events: keep.map((e) => ({ iso: e.iso, endIso: e.endIso, label: e.label, kind: e.kind, season: e.season, source: e.source })),
    });
    setSaved(`✓ ${res.saved} calendar events coded for ${importYears.join(", ")} — term dates and holiday flags now follow them.`);
    setText(""); setEdits({}); setFileNote(null);
    router.refresh();
  });

  const summary = coded.length
    ? `${codedCounts.starts} semester starts · ${codedCounts.breaks} breaks · ${codedYears.join("–")}`
    : `pattern only — Spring ${fmtMMDD(anchors.springStart)} · Summer ${fmtMMDD(anchors.summerStart)} · Fall ${fmtMMDD(anchors.fallStart)}`;

  return (
    <Collapse title={`Academic calendar — ${institutionName}`} sub="Paste the college calendar; semester dates and breaks are coded automatically and every offering's term dates follow them." summary={summary}>
      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        {/* ── Import ── */}
        <div className="space-y-3">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void readFile(f); }}
            className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 p-3"
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-800">Import the calendar</span>
              <span className="flex items-center gap-2 text-xs text-slate-500">
                <button type="button" onClick={() => fileRef.current?.click()} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-100">Choose Excel / CSV / text…</button>
                or drop it here
                <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.xls,.csv,.tsv,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = ""; }} />
              </span>
            </div>
            <textarea
              value={text} onChange={(e) => { setText(e.target.value); setEdits({}); setSaved(null); }}
              placeholder={PLACEHOLDER} rows={9}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-700 focus:border-rose-400 focus:outline-none"
            />
            {fileNote && <p className="mt-1 text-[11px] text-slate-500">{fileNote}</p>}
            <p className="mt-1 text-[11px] text-slate-500">Copy the calendar text from the college website or its PDF and paste it, or drop the spreadsheet. Dates in any common format work: “August 17, 2026”, “Aug 17–21”, “8/17/26”, “2026-08-17”. Headers like “Fall 2026” or “2026–2027” fill in missing years.</p>
          </div>

          {text.trim() && (
            <div className="rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
                <span className="text-sm font-semibold text-slate-800">
                  Coded: {c.starts} semester start{c.starts === 1 ? "" : "s"} · {c.ends} end{c.ends === 1 ? "" : "s"} · {c.sessions} later session{c.sessions === 1 ? "" : "s"} · {c.breaks} holiday{c.breaks === 1 ? "" : "s"}/break{c.breaks === 1 ? "" : "s"}
                  <span className="ml-2 text-xs font-normal text-slate-500">{events.length - keep.length} ignored</span>
                </span>
                <button onClick={save} disabled={pending || !keep.length} className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50">
                  {pending ? "Saving…" : `Save calendar${importYears.length ? ` (${importYears.join(", ")})` : ""}`}
                </button>
              </div>
              {parsed.warnings.length > 0 && (
                <ul className="border-b border-amber-100 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-800">{parsed.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}</ul>
              )}
              {c.starts > 0 && (
                <p className="border-b border-slate-100 px-3 py-2 text-xs text-slate-600">
                  Semester pattern from these dates: Spring on/after <strong>{fmtMMDD(nextAnchors.springStart)}</strong> · Summer <strong>{fmtMMDD(nextAnchors.summerStart)}</strong> · Fall <strong>{fmtMMDD(nextAnchors.fallStart)}</strong> (Monday on/after; years not coded follow the pattern).
                </p>
              )}
              <div className="max-h-[26rem] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                    <tr><th className="px-3 py-1.5 text-left">Date</th><th className="px-2 py-1.5 text-left">Event</th><th className="px-2 py-1.5 text-left">Coded as</th><th className="px-2 py-1.5 text-left">Semester</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {events.map((e, i) => (
                      <tr key={i} className={e.kind === "other" ? "text-slate-400" : ""}>
                        <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{span(e)}</td>
                        <td className="px-2 py-1.5"><span className="block max-w-[18rem] truncate" title={e.source}>{e.label}</span></td>
                        <td className="px-2 py-1.5">
                          <select value={e.kind} onChange={(ev) => setEdits((p) => ({ ...p, [i]: { ...(p[i] ?? {}), kind: ev.target.value as EventKind } }))} className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${KIND_TONE[e.kind]}`}>
                            {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <select value={e.season} onChange={(ev) => setEdits((p) => ({ ...p, [i]: { ...(p[i] ?? {}), season: ev.target.value as Season } }))} className="rounded border border-slate-200 px-1 py-0.5 text-[11px]">
                            {SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {saved && <p className="text-sm font-medium text-emerald-700">{saved}</p>}
        </div>

        {/* ── What's coded now ── */}
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-sm font-semibold text-slate-800">What every offering follows now</div>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
              {([["Spring", anchors.springStart], ["Summer", anchors.summerStart], ["Fall", anchors.fallStart]] as const).map(([s, v]) => (
                <div key={s} className="rounded-lg bg-slate-50 px-2 py-1.5">
                  <dt className="text-[10px] uppercase tracking-wide text-slate-500">{s} starts</dt>
                  <dd className="text-sm font-semibold text-slate-800">Mon on/after {fmtMMDD(v)}</dd>
                </div>
              ))}
            </dl>
            {coded.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">No calendar imported yet — term dates follow this pattern and sessions are checked against U.S. holidays only. Paste the college calendar to code the real dates.</p>
            ) : (
              <>
                <div className="mt-3 space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Coded semesters, in order</div>
                  {coded.filter((e) => e.kind === "term_start").sort((a, b) => a.iso.localeCompare(b.iso)).map((st) => {
                    const en = coded.find((e) => e.kind === "term_end" && e.season === st.season && e.iso > st.iso && e.iso.slice(0, 4) === st.iso.slice(0, 4));
                    return (
                      <div key={st.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                        <span className="w-24 font-semibold text-slate-700">{st.season} {st.iso.slice(0, 4)}</span>
                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800">{fmt(st.iso)}{en ? ` → ${fmtShort(en.iso)}` : ""}</span>
                      </div>
                    );
                  })}
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-medium text-slate-600">All {coded.length} coded events ({codedCounts.breaks} holidays / breaks) — remove any</summary>
                  <ul className="mt-1 max-h-64 divide-y divide-slate-100 overflow-y-auto text-xs">
                    {coded.map((e) => (
                      <li key={e.id} className="flex items-center gap-2 py-1">
                        <span className="w-44 shrink-0 whitespace-nowrap tabular-nums text-slate-600">{span(e)}</span>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${KIND_TONE[e.kind] ?? ""}`}>{KIND_LABEL[e.kind as EventKind] ?? e.kind}</span>
                        <span className="min-w-0 flex-1 truncate text-slate-700" title={e.label}>{e.label}</span>
                        <button onClick={() => startTransition(async () => { await deleteAcademicEvent(e.id, familyId); router.refresh(); })} className="shrink-0 rounded px-1 text-slate-300 hover:bg-rose-100 hover:text-rose-700" title="remove">×</button>
                      </li>
                    ))}
                  </ul>
                  <button onClick={() => { if (confirm("Remove every coded calendar event for this institution? Term dates fall back to the pattern.")) startTransition(async () => { await clearAcademicCalendar(institutionId, familyId); router.refresh(); }); }} className="mt-2 text-[11px] text-rose-600 hover:underline">Clear the imported calendar</button>
                </details>
              </>
            )}
          </div>

          <details className="rounded-xl border border-slate-200 bg-white p-3">
            <summary className="cursor-pointer text-xs font-medium text-slate-600">Set the semester pattern by hand instead</summary>
            <form action={updateInstitutionCalendar.bind(null, institutionId, familyId)} className="mt-2 flex flex-wrap items-end gap-3">
              {([["springStart", "Spring", anchors.springStart], ["summerStart", "Summer", anchors.summerStart], ["fallStart", "Fall", anchors.fallStart]] as const).map(([name, label, val]) => (
                <label key={name} className="block">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label} on/after (MM-DD)</span>
                  <input name={name} defaultValue={val} pattern="\d{2}-\d{2}" className="w-24 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm tabular-nums" />
                </label>
              ))}
              <button className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">Save pattern</button>
            </form>
          </details>
        </div>
      </div>
    </Collapse>
  );
}
