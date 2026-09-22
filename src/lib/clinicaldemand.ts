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
import { ruleFromLegacy, eligibleSettings, type SettingRuleSpec } from "./settingrule";

/** A rotation row as the demand builders read it: the explicit rule when stored; the legacy code otherwise (adapted, never collapsed). */
export interface RotationCodeLite { rotationType: string; settingCode: string | null; rule?: SettingRuleSpec | null; sourceText?: string | null; interpretationStatus?: string | null }
export interface ClinicalDemandRow {
  row: DatedInstance;
  dateIso: string;
  block: ShiftBlock;
  rotationType: string;
  /** The PRIMARY setting (the rule's first eligible setting) — a compatibility label for views keyed by one code; never the whole rule. */
  settingCode: string | null;
  /** The explicit setting rule (alternatives, components, minimums, mixing, continuity, review status) and every setting it can draw on. */
  rule: SettingRuleSpec | null;
  eligible: string[];
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
  const ruleOf = new Map(rotations.map((r) => [r.rotationType.trim().toLowerCase(), r.rule === undefined ? ruleFromLegacy({ rotationType: r.rotationType, settingCode: r.settingCode, rule: null, sourceText: r.sourceText ?? null, interpretationStatus: r.interpretationStatus ?? null }) : r.rule]));
  const out: ClinicalDemandRow[] = [];
  for (const r of rows) {
    if (r.session.kind !== "CLINICAL" || !r.dateIso) continue;
    const sections = Math.max(0, Math.round(r.computed.Y ?? 0));
    const enrollment = Math.max(0, Math.round(r.computed.C ?? 0));
    const seatsPerSection = Math.max(1, r.session.maxStudents ?? 1);
    const rotationType = r.session.rotationType?.trim() || UNSPECIFIED_ROTATION;
    const rule = ruleOf.get(rotationType.toLowerCase()) ?? null;
    const eligible = rule ? eligibleSettings(rule.rule) : [];
    out.push({
      row: r, dateIso: r.dateIso, block: shiftBlockOf(r.session.startTime ?? null), rotationType,
      settingCode: eligible[0] ?? null, rule, eligible,
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
