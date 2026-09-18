// Dated clinical demand — ONE definition (Phase 4 of docs/metrics-audit.md). The scheduler's demand
// units and the site-capacity asset map both start from these rows, so the two views can never
// disagree on what a cohort needs; they may aggregate it differently (by section vs by date × block),
// and the scope strip says how. Site load is a different population by design (the roster), and
// the bridge on those pages puts the three totals side by side.
//
// Per dated clinical session row: how many sections run (Y, whole), how many students must be on
// site (C capped at Y × max students), the shift block from the start time, and the asset setting
// the rotation type maps to.

import type { DatedInstance } from "./capacitymodel";
import { shiftBlockOf, type ShiftBlock } from "./clinicalsupply";

export interface RotationCodeLite { rotationType: string; settingCode: string | null }
export interface ClinicalDemandRow {
  row: DatedInstance;
  dateIso: string;
  block: ShiftBlock;
  rotationType: string;
  settingCode: string | null;
  /** Sections of this session on this date (whole; 0 = nothing runs). */
  sections: number;
  /** Students who must be on site: enrollment capped at sections × max students. */
  students: number;
  /** Seats per section (the session's max students, at least 1). */
  seatsPerSection: number;
}

export const UNSPECIFIED_ROTATION = "(unspecified)";

/** The dated clinical rows of a set of instances, one per session × date, mapped to settings. */
export function clinicalDemandRows(rows: DatedInstance[], rotations: RotationCodeLite[]): ClinicalDemandRow[] {
  const codeOf = new Map(rotations.map((r) => [r.rotationType.toLowerCase(), r.settingCode]));
  const out: ClinicalDemandRow[] = [];
  for (const r of rows) {
    if (r.session.kind !== "CLINICAL" || !r.dateIso) continue;
    const sections = Math.max(0, Math.round(r.computed.Y ?? 0));
    const enrollment = Math.max(0, Math.round(r.computed.C ?? 0));
    const seatsPerSection = Math.max(1, r.session.maxStudents ?? 1);
    const rotationType = r.session.rotationType?.trim() || UNSPECIFIED_ROTATION;
    out.push({
      row: r, dateIso: r.dateIso, block: shiftBlockOf(r.session.startTime ?? null), rotationType,
      settingCode: codeOf.get(rotationType.toLowerCase()) ?? null,
      sections, students: Math.min(enrollment, sections * seatsPerSection), seatsPerSection,
    });
  }
  return out;
}

/** Learner-shifts (student × date) in the rows — the one total every capacity view must agree on for the same scope. */
export const learnerShifts = (rows: ClinicalDemandRow[]) => rows.reduce((n, r) => n + r.students, 0);
/** Shifts (section × date). */
export const sectionShifts = (rows: ClinicalDemandRow[]) => rows.reduce((n, r) => n + (r.students > 0 ? r.sections : 0), 0);
/** The rows inside a date window (inclusive). */
export const inWindow = <T extends { dateIso: string }>(rows: T[], from: string, to: string) => rows.filter((r) => r.dateIso >= from && r.dateIso <= to);
