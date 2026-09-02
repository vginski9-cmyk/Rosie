"use client";

// Drop a schedule in — the Excel someone already keeps, a CSV, or cells pasted
// from a sheet — and the columns are recognized, every row becomes a session
// with its fields filled in, you check the mapping and the rows, then import.
// Template mode writes the program's terms / courses / sessions; offering mode
// stores what differs from the template as this offering's overrides.

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { detectHeader, rowsToSessions, textToRows, IMPORT_FIELDS, IMPORT_FIELD_LABEL, type ImportField, type HeaderDetection } from "@/lib/sheetimport";
import { importProgramSheet, importOfferingSheet } from "@/lib/actions";

export function SheetImport({ mode, programId, cohortId }: { mode: "template" | "offering"; programId: string; cohortId?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<unknown[][]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [mapEdits, setMapEdits] = useState<Record<number, ImportField | "">>({});
  const [replace, setReplace] = useState(true);
  const [result, setResult] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const detected = useMemo(() => (rows.length ? detectHeader(rows) : null), [rows]);
  const det: HeaderDetection | null = useMemo(() => {
    if (!detected) return null;
    const map: Record<number, ImportField> = { ...detected.map };
    for (const [i, f] of Object.entries(mapEdits)) { if (f) map[Number(i)] = f; else delete map[Number(i)]; }
    return { ...detected, map };
  }, [detected, mapEdits]);
  const parsed = useMemo(() => (det ? rowsToSessions(rows, det) : null), [rows, det]);
  const headerCells: string[] = det ? (rows[det.headerRow] ?? []).map((c) => String(c ?? "").trim()) : [];

  const load = async (f: File) => {
    setResult(null); setMapEdits({});
    const name = f.name.toLowerCase();
    if (/\.(xlsx|xlsm|xls)$/.test(name)) {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: false });
      // The sheet whose header names the most known columns wins.
      let best: { rows: unknown[][]; n: number; name: string } | null = null;
      for (const sn of wb.SheetNames) {
        const r = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sn], { header: 1, raw: true, defval: null });
        const d = detectHeader(r);
        const n = d ? Object.keys(d.map).length : 0;
        if (!best || n > best.n) best = { rows: r, n, name: sn };
      }
      setRows(best?.rows ?? []); setSource(`${f.name} — sheet “${best?.name ?? ""}”`);
    } else {
      setRows(textToRows(await f.text())); setSource(f.name);
    }
    setOpen(true);
  };

  const run = () => {
    if (!parsed) return;
    startTransition(async () => {
      if (mode === "template") {
        const r = await importProgramSheet(programId, parsed.sessions, { replace });
        setResult(`✓ Imported ${r.sessions} sessions — ${r.courses} new course${r.courses === 1 ? "" : "s"}, ${r.terms} new term${r.terms === 1 ? "" : "s"}. Every field is editable below.`);
      } else if (cohortId) {
        const r = await importOfferingSheet(cohortId, programId, parsed.sessions);
        setResult(`✓ ${r.matched} rows matched to this offering's sessions and stored as its overrides.${r.unmatched.length ? ` ${r.unmatched.length} not matched: ${r.unmatched.slice(0, 5).join("; ")}${r.unmatched.length > 5 ? " …" : ""}` : ""}`);
      }
      setRows([]); setSource(null);
      router.refresh();
    });
  };

  return (
    <section className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 p-4"
      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void load(f); }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-800">Already have this in a spreadsheet? Drop it here.</div>
          <div className="text-xs text-slate-500">
            Excel, CSV, or cells pasted from a sheet — the workbook&apos;s own headers or everyday ones (Course, Type, Duration, Day, Start time, Capacity, Rotation…). Columns are recognized, blank term / course cells fill down, sessions are numbered, days and times are normalized. You check the mapping, then import.
            {mode === "offering" && " For this offering, rows are matched to the template's sessions and stored as overrides."}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">Choose file…</button>
          <button type="button" onClick={() => setOpen((o) => !o)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">{open ? "Hide" : "Paste cells"}</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.xls,.csv,.tsv,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ""; }} />
        </div>
      </div>
      {result && <p className="mt-2 text-sm font-medium text-emerald-700">{result}</p>}

      {open && !rows.length && (
        <textarea rows={5} placeholder={"Paste rows copied from Excel / Google Sheets — include the header row.\nTerm Number\tSemester\tCourse Code\tCourse Title\tSession Type\tSession title\tSession length (in hours)\t…"}
          onChange={(e) => { const r = textToRows(e.target.value); setRows(r); setSource("pasted cells"); setMapEdits({}); setResult(null); }}
          className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs" />
      )}

      {rows.length > 0 && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <span><strong>{source}</strong> · {rows.length} rows{det ? ` · header on row ${det.headerRow + 1}` : ""}</span>
            <button type="button" onClick={() => { setRows([]); setSource(null); setMapEdits({}); }} className="text-slate-500 hover:text-rose-700">discard</button>
          </div>
          {!det ? (
            <p className="text-sm text-amber-700">No header row recognized — the sheet needs a row naming at least three columns (Course, Type, Length, Day…).</p>
          ) : (
            <>
              {/* Column mapping — what each sheet column feeds */}
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Column mapping — change any that&apos;s wrong</div>
                <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {headerCells.map((h, i) => (h ? (
                    <label key={i} className="flex items-center gap-2 text-xs">
                      <span className="w-40 truncate text-slate-700" title={h}>{h}</span>
                      <span className="text-slate-300">→</span>
                      <select value={det.map[i] ?? ""} onChange={(e) => setMapEdits((p) => ({ ...p, [i]: e.target.value as ImportField | "" }))} className={`min-w-0 flex-1 rounded border px-1 py-0.5 ${det.map[i] ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-slate-200 text-slate-400"}`}>
                        <option value="">(ignore)</option>
                        {IMPORT_FIELDS.map((f) => <option key={f} value={f}>{IMPORT_FIELD_LABEL[f]}</option>)}
                      </select>
                    </label>
                  ) : null))}
                </div>
              </div>

              {/* Row preview */}
              {parsed && (
                <div className="rounded-lg border border-slate-200 bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
                    <span className="text-sm font-semibold text-slate-800">{parsed.sessions.length} sessions ready{parsed.skipped ? ` · ${parsed.skipped} rows skipped` : ""}</span>
                    <div className="flex items-center gap-3">
                      {mode === "template" && (
                        <label className="flex items-center gap-1.5 text-xs text-slate-600">
                          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                          replace the imported courses&apos; existing sessions of the same type (off = append)
                        </label>
                      )}
                      <button type="button" onClick={run} disabled={pending || !parsed.sessions.length} className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50">{pending ? "Importing…" : mode === "template" ? "Import into the template" : "Import into this offering"}</button>
                    </div>
                  </div>
                  {parsed.issues.length > 0 && <ul className="border-b border-amber-100 bg-amber-50/60 px-3 py-1.5 text-[11px] text-amber-800">{parsed.issues.slice(0, 8).map((w, i) => <li key={i}>⚠ {w}</li>)}{parsed.issues.length > 8 && <li>… {parsed.issues.length - 8} more</li>}</ul>}
                  <div className="max-h-72 overflow-auto">
                    <table className="w-full text-[11px]">
                      <thead className="sticky top-0 bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                        <tr><th className="px-2 py-1">Term</th><th className="px-2 py-1">Course</th><th className="px-2 py-1">Type #</th><th className="px-2 py-1">Title</th><th className="px-2 py-1 text-right">Hrs</th><th className="px-2 py-1 text-right">Max</th><th className="px-2 py-1 text-right">Fac</th><th className="px-2 py-1 text-right">Prec</th><th className="px-2 py-1">Wk · day · time</th><th className="px-2 py-1">Mode · location</th><th className="px-2 py-1">Rotation · clinical mode</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {parsed.sessions.map((s, i) => (
                          <tr key={i}>
                            <td className="px-2 py-1 tabular-nums">{s.termNumber ?? "—"}{s.semester ? ` · ${s.semester}` : ""}</td>
                            <td className="px-2 py-1">{s.courseCode ?? ""}{s.courseCode && s.courseTitle ? " · " : ""}{s.courseTitle ?? ""}</td>
                            <td className="px-2 py-1">{s.kind.toLowerCase()} #{s.number}</td>
                            <td className="max-w-[14rem] truncate px-2 py-1">{s.title ?? ""}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{s.lengthHours ?? "—"}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{s.maxStudents ?? "—"}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{s.facultyNeeded ?? "—"}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{s.preceptorsNeeded ?? "—"}</td>
                            <td className="px-2 py-1">{[s.week != null ? `wk ${s.week}` : null, s.dayOfWeek, s.startTime].filter(Boolean).join(" · ") || "—"}</td>
                            <td className="px-2 py-1">{[s.deliveryMode, s.location].filter(Boolean).join(" · ") || "—"}</td>
                            <td className="px-2 py-1">{[s.rotationType, s.clinicalMode].filter(Boolean).join(" · ") || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
