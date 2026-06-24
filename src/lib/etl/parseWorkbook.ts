// ETL: workbook ingestion.
//
// Stage 1 of every data flow in Rosie is "land the spreadsheet". Program leads
// live in Excel — Lightcast demand exports, the program-planning template, term
// & block calendars. This module parses an uploaded workbook into a uniform
// shape and tries to recognize which Rosie entity each sheet maps to, so the
// import UI can preview and load it. Pure (no DB) so it is easy to test.

import * as XLSX from "xlsx";

export interface ParsedSheet {
  name: string;
  headers: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  /** Best-guess Rosie entity this sheet maps to. */
  detected: DetectedType;
}

export interface ParsedWorkbook {
  sheets: ParsedSheet[];
}

export type DetectedType =
  | "calendar_blocks"
  | "demand"
  | "funnel"
  | "program_structure"
  | "unknown";

const norm = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Detect which entity a sheet maps to from its header names. */
export function detectType(headers: string[]): DetectedType {
  const h = headers.map(norm);
  const has = (sub: string) => h.some((x) => x.includes(sub));

  if (has("block key") && (has("block start date") || has("non-holiday"))) return "calendar_blocks";
  if ((has("interested candidate") || has("qualified applicant")) && (has("target") || has("actual"))) return "funnel";
  if (has("number of openings") || (has("area") && h.filter((x) => /^\d{4}$/.test(x)).length >= 3)) return "demand";
  if ((has("course code") || has("course name")) && (has("session") || has("weekly class hours"))) return "program_structure";
  return "unknown";
}

/** Parse a workbook buffer into uniform sheets with detection + a row preview. */
export function parseWorkbook(buffer: Buffer | ArrayBuffer, opts?: { previewRows?: number }): ParsedWorkbook {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const previewRows = opts?.previewRows ?? 50;

  const sheets: ParsedSheet[] = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
    const headers = json.length > 0 ? Object.keys(json[0]) : [];
    return {
      name,
      headers,
      rows: json.slice(0, previewRows),
      rowCount: json.length,
      detected: detectType(headers),
    };
  });

  return { sheets };
}

// --- Mappers: turn a recognized sheet into typed records ready for the DB ---

export interface CalendarBlockRecord {
  blockKey: string;
  termKey: string | null;
  academicYear: number | null;
  termCode: string | null;
  name: string;
  startDate: string | null;
  endDate: string | null;
  lengthWeeks: number | null;
  lengthDays: number | null;
  nonHolidayMon: number | null;
  nonHolidayTue: number | null;
  nonHolidayWed: number | null;
  nonHolidayThu: number | null;
  nonHolidayFri: number | null;
}

const pick = (row: Record<string, unknown>, ...names: string[]): unknown => {
  const keys = Object.keys(row);
  for (const n of names) {
    const k = keys.find((key) => norm(key) === norm(n) || norm(key).startsWith(norm(n)));
    if (k != null) return row[k];
  }
  return null;
};

const toNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const toDateStr = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

export function mapCalendarBlocks(sheet: ParsedSheet): CalendarBlockRecord[] {
  return sheet.rows
    .filter((r) => pick(r, "Block Key"))
    .map((r) => ({
      blockKey: String(pick(r, "Block Key")),
      termKey: pick(r, "Term Key") ? String(pick(r, "Term Key")) : null,
      academicYear: toNum(pick(r, "Academic Year")),
      termCode: pick(r, "Term Code") ? String(pick(r, "Term Code")) : null,
      name: String(pick(r, "Block Name") ?? pick(r, "Block Key")),
      startDate: toDateStr(pick(r, "Block Start Date")),
      endDate: toDateStr(pick(r, "Block End Date")),
      lengthWeeks: toNum(pick(r, "Block Length Weeks")),
      lengthDays: toNum(pick(r, "Block Length Days")),
      nonHolidayMon: toNum(pick(r, "Non-Holiday Mondays")),
      nonHolidayTue: toNum(pick(r, "Non-Holiday Tuesdays")),
      nonHolidayWed: toNum(pick(r, "Non-Holiday Wednesdays", "Non-Holiday Wednesda")),
      nonHolidayThu: toNum(pick(r, "Non-Holiday Thursdays", "Non-Holiday Thursday")),
      nonHolidayFri: toNum(pick(r, "Non-Holiday Fridays")),
    }));
}
