"use client";

import { useState } from "react";

interface SheetPreview {
  name: string;
  detected: string;
  headers: string[];
  rowCount: number;
  sample: Record<string, unknown>[];
}

const DETECT_LABEL: Record<string, { label: string; color: string }> = {
  calendar_blocks: { label: "Calendar blocks", color: "bg-emerald-100 text-emerald-700" },
  demand: { label: "Labor-market demand", color: "bg-sky-100 text-sky-700" },
  funnel: { label: "Talent-pipeline funnel", color: "bg-violet-100 text-violet-700" },
  program_structure: { label: "Program structure", color: "bg-rose-100 text-rose-700" },
  unknown: { label: "Unrecognized", color: "bg-slate-100 text-slate-500" },
};

export function Importer({ institutions }: { institutions: { id: string; name: string }[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ fileName: string; sheets: SheetPreview[] } | null>(null);
  const [institutionId, setInstitutionId] = useState(institutions[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: "preview" | "load") {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("action", action);
    if (action === "load") fd.append("institutionId", institutionId);
    try {
      const res = await fetch("/api/import", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Import failed");
      } else if (action === "preview") {
        setPreview(json);
      } else {
        setResult(`Loaded ${json.loaded} record(s). ${json.log?.join(" · ") ?? ""}`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const loadable = preview?.sheets.some((s) => s.detected === "calendar_blocks");

  return (
    <div className="space-y-6">
      <div className="card card-pad space-y-4">
        <div
          className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) {
              setFile(f);
              setPreview(null);
            }
          }}
        >
          <input
            id="file"
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
            }}
          />
          <label htmlFor="file" className="btn-primary cursor-pointer">
            Choose spreadsheet
          </label>
          <p className="mt-3 text-sm text-slate-500">{file ? file.name : "or drag an .xlsx / .csv here"}</p>
          <p className="mt-1 text-xs text-slate-400">
            Try the Cape Fear workbook&apos;s <em>INPUT TERM AND BLOCK INFO</em> sheet — Rosie auto-detects calendar blocks.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => submit("preview")} disabled={!file || busy} className="btn-primary disabled:opacity-40">
            {busy ? "Parsing…" : "Parse & preview"}
          </button>
          {loadable && (
            <>
              <span className="text-sm text-slate-500">→ load detected data into</span>
              <select value={institutionId} onChange={(e) => setInstitutionId(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                {institutions.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
              <button onClick={() => submit("load")} disabled={busy} className="btn-ghost">
                Load to database
              </button>
            </>
          )}
        </div>

        {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        {result && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{result}</div>}
      </div>

      {preview && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">
            {preview.fileName} — {preview.sheets.length} sheet(s)
          </h2>
          {preview.sheets.map((s) => {
            const d = DETECT_LABEL[s.detected] ?? DETECT_LABEL.unknown;
            return (
              <div key={s.name} className="card card-pad">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{s.name}</div>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span>{s.rowCount} rows</span>
                    <span className={`badge ${d.color}`}>{d.label}</span>
                  </div>
                </div>
                {s.sample.length > 0 && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50">
                        <tr>
                          {s.headers.slice(0, 8).map((h) => (
                            <th key={h} className="th whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {s.sample.map((row, i) => (
                          <tr key={i}>
                            {s.headers.slice(0, 8).map((h) => (
                              <td key={h} className="td whitespace-nowrap">
                                {row[h] == null ? "" : String(row[h]).slice(0, 24)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
