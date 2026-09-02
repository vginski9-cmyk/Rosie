// The session row, field by field — the SAME workbook columns (A–AE) with their
// FULL headers, used by the template sheet, the per-offering sheet, the add-
// session form and the spreadsheet importer. Nothing abbreviated: the label a
// person sees is the workbook's own header text.

import { CAPACITY_HEADERS, CAPACITY_FORMULAS } from "./capacitymodel";

export type SessionKindKey = "CLASS" | "LAB" | "CLINICAL";
export type FieldInput = "select" | "number" | "text" | "textarea" | "time";

export interface SessionField {
  /** Workbook column letter. */
  col: string;
  /** The full workbook header. */
  header: string;
  /** Session field name (editable columns) — null for sequence-derived / formula columns. */
  field: EditableField | null;
  kind: "seq" | "edit" | "calc";
  input?: FieldInput;
  /** Drop-down choices (people can add their own). */
  options?: readonly string[];
  /** Numeric step. */
  step?: number;
  /** Takes extra grid width. */
  wide?: boolean;
  /** What drives / how to read it. */
  hint?: string;
}

export type EditableField =
  | "kind" | "title" | "deliveryMode" | "location" | "lengthHours" | "maxStudents"
  | "facultyNeeded" | "facultyContactPolicy" | "supportStaffNeeded" | "supportContactPolicy"
  | "week" | "dayOfWeek" | "startTime" | "notes" | "preceptorsNeeded" | "preceptorContactPolicy"
  | "rotationType" | "clinicalMode";

/** Drop-down choices — starting lists; every value already in the data joins the
 *  list, and people can add their own from any field. */
export const FIELD_OPTIONS = {
  kind: ["CLASS", "LAB", "CLINICAL"],
  semester: ["Fall", "Spring", "Summer"],
  deliveryMode: ["In-person", "Online — synchronous", "Online — asynchronous", "Hybrid", "HyFlex", "Simulation"],
  location: ["Classroom", "Lecture hall", "Skills lab", "Simulation lab", "Computer lab", "Mock OR", "Clinical site", "Community site", "Online"],
  dayOfWeek: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  contactPolicy: ["0.5", "1", "1.5", "2", "2.5", "3"],
  rotationType: [
    "Med-Surg", "ICU / Critical Care", "Emergency", "Operating Room", "Pediatrics", "OB / Maternity", "Behavioral Health",
    "Long-Term Care", "Rehabilitation", "Ambulatory / Clinic", "Doctor's Office", "Community / Public Health", "Home Health",
    "Imaging", "Laboratory", "Hospice",
  ],
  clinicalMode: ["Instructor-led", "Preceptor-led", "Hybrid", "Simulation", "Observation"],
} as const;

export const KIND_LABELS: Record<SessionKindKey, string> = { CLASS: "Class", LAB: "Lab", CLINICAL: "Clinical" };

const H = (c: keyof typeof CAPACITY_HEADERS) => CAPACITY_HEADERS[c];

/** Every workbook column, in order, with its full header. */
export const SESSION_FIELDS: SessionField[] = [
  { col: "A", header: H("A"), field: null, kind: "seq", hint: CAPACITY_FORMULAS.A },
  { col: "B", header: H("B"), field: null, kind: "seq", hint: CAPACITY_FORMULAS.B },
  { col: "C", header: H("C"), field: null, kind: "calc", hint: CAPACITY_FORMULAS.C },
  { col: "D", header: H("D"), field: null, kind: "seq" },
  { col: "E", header: H("E"), field: null, kind: "seq" },
  { col: "F", header: H("F"), field: "kind", kind: "edit", input: "select", options: FIELD_OPTIONS.kind },
  { col: "G", header: H("G"), field: null, kind: "seq", hint: "Numbered in order within the course and session type" },
  { col: "H", header: H("H"), field: "title", kind: "edit", input: "text", wide: true },
  { col: "I", header: H("I"), field: "deliveryMode", kind: "edit", input: "select", options: FIELD_OPTIONS.deliveryMode },
  { col: "J", header: H("J"), field: "location", kind: "edit", input: "select", options: FIELD_OPTIONS.location },
  { col: "K", header: H("K"), field: "lengthHours", kind: "edit", input: "number", step: 0.25 },
  { col: "L", header: H("L"), field: "maxStudents", kind: "edit", input: "number", step: 1 },
  { col: "M", header: H("M"), field: "facultyNeeded", kind: "edit", input: "number", step: 0.05 },
  { col: "N", header: H("N"), field: "facultyContactPolicy", kind: "edit", input: "number", step: 0.25, options: FIELD_OPTIONS.contactPolicy },
  { col: "O", header: H("O"), field: "supportStaffNeeded", kind: "edit", input: "number", step: 0.05 },
  { col: "P", header: H("P"), field: "supportContactPolicy", kind: "edit", input: "number", step: 0.25, options: FIELD_OPTIONS.contactPolicy },
  { col: "Q", header: H("Q"), field: "week", kind: "edit", input: "number", step: 1 },
  { col: "R", header: H("R"), field: "dayOfWeek", kind: "edit", input: "select", options: FIELD_OPTIONS.dayOfWeek },
  { col: "S", header: H("S"), field: "notes", kind: "edit", input: "textarea", wide: true },
  { col: "T", header: H("T"), field: "preceptorsNeeded", kind: "edit", input: "number", step: 0.05 },
  { col: "U", header: H("U"), field: "preceptorContactPolicy", kind: "edit", input: "number", step: 0.25, options: FIELD_OPTIONS.contactPolicy },
  { col: "V", header: H("V"), field: "rotationType", kind: "edit", input: "select", options: FIELD_OPTIONS.rotationType },
  { col: "W", header: H("W"), field: "clinicalMode", kind: "edit", input: "select", options: FIELD_OPTIONS.clinicalMode },
  { col: "X", header: H("X"), field: null, kind: "calc", hint: CAPACITY_FORMULAS.X },
  { col: "Y", header: H("Y"), field: null, kind: "calc", hint: CAPACITY_FORMULAS.Y },
  { col: "Z", header: H("Z"), field: null, kind: "calc", hint: CAPACITY_FORMULAS.Z },
  { col: "AA", header: H("AA"), field: null, kind: "calc", hint: CAPACITY_FORMULAS.AA },
  { col: "AB", header: H("AB"), field: null, kind: "calc", hint: CAPACITY_FORMULAS.AB },
  { col: "AC", header: H("AC"), field: null, kind: "calc", hint: CAPACITY_FORMULAS.AC },
  { col: "AD", header: H("AD"), field: null, kind: "calc", hint: CAPACITY_FORMULAS.AD },
  { col: "AE", header: H("AE"), field: null, kind: "calc", hint: CAPACITY_FORMULAS.AE },
];

/** The editable field names, in workbook order — what a form submits. */
export const EDITABLE_FIELDS: EditableField[] = SESSION_FIELDS.filter((f) => f.field).map((f) => f.field!) as EditableField[];
/** Start time isn't a workbook column but is part of every booking; forms carry it too. */
export const FORM_FIELDS: EditableField[] = [...EDITABLE_FIELDS, "startTime"];

export const NUMERIC_FIELDS = new Set<EditableField>(["lengthHours", "maxStudents", "facultyNeeded", "facultyContactPolicy", "supportStaffNeeded", "supportContactPolicy", "week", "preceptorsNeeded", "preceptorContactPolicy"]);

/** Sensible starting values for a new session of each type. */
export function defaultSession(kind: SessionKindKey): Record<EditableField, string | number | null> {
  const base = {
    kind, title: null, deliveryMode: "In-person", location: kind === "CLINICAL" ? "Clinical site" : kind === "LAB" ? "Skills lab" : "Classroom",
    lengthHours: kind === "CLINICAL" ? 8 : 2, maxStudents: kind === "CLINICAL" ? 2 : kind === "LAB" ? 12 : 30,
    facultyNeeded: kind === "CLINICAL" ? 0 : 1, facultyContactPolicy: kind === "CLASS" ? 2.5 : 2,
    supportStaffNeeded: 0, supportContactPolicy: 2,
    week: 1, dayOfWeek: null, startTime: null, notes: null,
    preceptorsNeeded: kind === "CLINICAL" ? 1 : 0, preceptorContactPolicy: kind === "CLINICAL" ? 1 : null,
    rotationType: null, clinicalMode: kind === "CLINICAL" ? "Preceptor-led" : null,
  };
  return base as Record<EditableField, string | number | null>;
}
