import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { getProgramFull, getProgramArchetype } from "@/lib/queries";
import { programDemand } from "@/lib/capacity";
import { analyzeFunnel, type StageKey } from "@/lib/funnel";
import { ruleBook, requirementLedger } from "@/lib/requirementstore";
import { describeRule } from "@/lib/settingrule";

export const runtime = "nodejs";

const ATTRITION = [1.0, 0.94, 0.88, 0.82, 0.76, 0.7];
const DAY_NAME: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
const KIND_NAME: Record<string, string> = { CLASS: "Class", LAB: "Lab", CLINICAL: "Clinical" };
/** "HH:MM" → "8:00 AM". */
const clock = (t: string | null) => { if (!t) return ""; const [h, m] = t.split(":").map(Number); if (!Number.isFinite(h)) return t; const ap = h >= 12 ? "PM" : "AM"; return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, "0")} ${ap}`; };

/** Excel-out: the program's structure in the colleges' own workbook layout (Enrollment, then Raw
 *  Data & Calculations — one row per session, column for column, with the workload-assumption
 *  blocks beside it), plus Terms & courses, the talent pipeline and capacity. The Raw Data sheet
 *  reads straight back in through "Drop it here" on Design & sequence. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const program = await getProgramFull(params.id);
  if (!program) return new Response("Not found", { status: 404 });
  const archetype = await getProgramArchetype(params.id);

  const enrollment = Number(new URL(req.url).searchParams.get("enrollment")) || Math.round(program.defaultCohortSeats ?? program.yearTargets.find((t) => t.cohortCapacity)?.cohortCapacity ?? 40);

  const wb = XLSX.utils.book_new();

  // --- Enrollment sheet: what each term is planned at ---
  const enrollmentRows = program.terms.map((t, i) => ({ Term: t.name, "Term Number": t.index, Semester: t.semester ?? "", Enrollment: Math.round(enrollment * (ATTRITION[i] ?? ATTRITION[ATTRITION.length - 1])) }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(enrollmentRows), "Enrollment");

  // --- Raw Data & Calculations: every session, in the workbook's columns ---
  const HEAD = [
    "Term Number", "Semester", "Enrollment", "Course Code", "Course Title", "Session Type", "Session Number", "Session title (if used)",
    "Session Delivery Mode", "Session Location", "Session length (in hours)", "Max number of students that ONE session can accommodate",
    "Number of faculty required to teach full session", "Contact hour policy for faculty during session (___hrs per contact hour)",
    "Number of support staff required to teach full session", "Contact hour policy for support staff during session (___hrs per contact hour)",
    "This session occurs during Week __ of term", "This session occurs on ____.", "Start time", "Notes",
    "Number of preceptors required to teach full clinical session", "Contact hour policy for preceptors during session (___hrs per contact hour)",
    "Clinical Rotation Type", "Clinical Mode",
  ];
  const raw: (string | number | null)[][] = [HEAD];
  for (const [i, t] of program.terms.entries()) {
    const termEnrollment = Math.round(enrollment * (ATTRITION[i] ?? ATTRITION[ATTRITION.length - 1]));
    for (const c of t.courses) {
      const sessions = [...c.sessions].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "CLASS" ? -1 : b.kind === "CLASS" ? 1 : a.kind === "LAB" ? -1 : 1) || (a.number ?? 0) - (b.number ?? 0));
      for (const s of sessions) {
        raw.push([
          t.index, t.semester ?? "", termEnrollment, c.code ?? "", c.name, KIND_NAME[s.kind] ?? s.kind, s.number, s.title ?? "",
          s.deliveryMode ?? "", s.location ?? "", s.lengthHours, s.maxStudents,
          s.facultyNeeded, s.facultyContactPolicy, s.supportStaffNeeded, s.supportContactPolicy,
          s.week, s.dayOfWeek ? DAY_NAME[s.dayOfWeek] ?? s.dayOfWeek : "", clock(s.startTime), s.notes ?? "",
          s.preceptorsNeeded, s.preceptorContactPolicy, s.rotationType ?? "", s.clinicalMode ?? "",
        ]);
      }
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(raw);
  // The workload-assumption blocks beside the first rows, as the college workbooks carry them.
  const a = program;
  const facConv = a.facContactHours ? a.facWorkWeekHours / a.facContactHours : 1;
  const preConv = a.preContactHours ? a.preWorkWeekHours / a.preContactHours : 1;
  XLSX.utils.sheet_add_aoa(ws, [
    ["Full time faculty student contact hours", "Number of hours in work week", "Full Time Faculty Contact Hour Conversion", "Number of weeks in Term", "Total Semesterly Faculty Contact Hours", "Weekly Faculty Contact Hours"],
    ["Faculty Workload Assumptions:", a.facContactHours, a.facWorkWeekHours, facConv, a.facTermWeeks, a.facContactHours * a.facTermWeeks, a.facContactHours],
    [],
    ["Full time preceptor contact hours", "Number of hours in work week", "Full Time Preceptor Contact Hour Conversion", "Number of weeks in Term", "Total Semesterly Preceptor Contact Hours", "Weekly Preceptor Contact Hours"],
    ["Preceptor Workload Assumptions", a.preContactHours, a.preWorkWeekHours, preConv, a.preTermWeeks, a.preContactHours * a.preTermWeeks, a.preContactHours],
  ], { origin: { r: 0, c: HEAD.length + 2 } });
  // Assumption labels sit in the column before their values, as in the workbooks: shift the header row right by one.
  ws["!cols"] = HEAD.map((h, i) => ({ wch: i === 7 || i === 19 ? 48 : Math.min(40, Math.max(12, h.length / 2)) }));
  XLSX.utils.book_append_sheet(wb, ws, "Raw Data & Calculations");

  // --- Terms & courses: the catalog view ---
  const courseRows = program.terms.flatMap((t) => t.courses.map((c) => ({
    "Term Number": t.index, Term: t.name, Semester: t.semester ?? "", "Weeks": Math.max(1, (t.endWeek ?? 16) - (t.startWeek ?? 1) + 1),
    "Course Code": c.code ?? "", "Course Title": c.name, Credits: c.creditHours, "Course Type": c.courseType ?? "",
    "Class h/wk": c.weeklyClassHours, "Lab h/wk": c.weeklyLabHours, "Clinical h/wk": c.weeklyClinicalHours,
    "Class sessions": c.sessions.filter((s) => s.kind === "CLASS").length, "Lab sessions": c.sessions.filter((s) => s.kind === "LAB").length, "Clinical sessions": c.sessions.filter((s) => s.kind === "CLINICAL").length,
    "Clinical hours / student": c.sessions.filter((s) => s.kind === "CLINICAL").reduce((n, s) => n + s.lengthHours, 0),
    Requisites: c.requisites ?? "", Description: c.description ?? "",
  })));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(courseRows), "Terms & Courses");

  // --- Funnel sheet ---
  const cohort = program.cohorts[0];
  if (cohort) {
    const analysis = analyzeFunnel(
      cohort.stages.map((s) => ({ key: s.stageKey as StageKey, label: s.label, target: s.targetNumber, actual: s.actualNumber })),
    );
    const rows = analysis.map((x) => ({
      Stage: x.label,
      Target: x.target ?? "",
      Actual: x.actual ?? "",
      "Plan conversion": x.targetConversion != null ? x.targetConversion * 100 : "",
      "Actual conversion": x.actualConversion != null ? x.actualConversion * 100 : "",
      "Attainment %": x.attainment != null ? x.attainment * 100 : "",
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Talent Pipeline");
  }

  // --- Capacity sheet ---
  const byTerm: Record<number, number> = {};
  archetype.forEach((t, i) => (byTerm[t.index] = Math.round(enrollment * (ATTRITION[i] ?? ATTRITION[ATTRITION.length - 1]))));
  const demand = programDemand(archetype, byTerm, enrollment);
  const capRows = demand.terms.map((td) => ({
    Term: td.name,
    Enrolled: td.enrollment,
    "Class sections": td.totals.classSections,
    "Lab sections": td.totals.labSections,
    "Clinical / WBL slots": td.totals.clinicalSections,
    "Faculty FTE": td.totals.facultyFTE,
    Preceptors: td.totals.preceptorInstances,
    "Room-hours": td.totals.roomHours,
  }));
  capRows.push({
    Term: "PROGRAM TOTAL",
    Enrolled: "" as unknown as number,
    "Class sections": demand.totals.classSections,
    "Lab sections": demand.totals.labSections,
    "Clinical / WBL slots": demand.totals.clinicalSections,
    "Faculty FTE": demand.totals.facultyFTE,
    Preceptors: demand.totals.preceptorInstances,
    "Room-hours": demand.totals.roomHours,
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(capRows), "Capacity");

  // --- Setting rules and structured requirements: what every clinical figure above was judged against (R1/R2). ---
  // Statuses are written as they are; a proposed or needs-review interpretation is never exported as settled.
  const [book, ledger] = await Promise.all([ruleBook(program.institutionId), requirementLedger(program.id)]);
  const usedTypes = new Set(program.terms.flatMap((t) => t.courses.flatMap((c) => c.sessions.map((s) => (s.rotationType ?? "").toLowerCase()).filter(Boolean))));
  const ruleRows = book.rows.filter((r) => usedTypes.size === 0 || usedTypes.has(r.rotationType.toLowerCase())).map((r) => {
    const spec = book.rules.get(r.rotationType.toLowerCase()) ?? null;
    return { "Rotation type": r.rotationType, "Setting rule": spec ? describeRule(spec.rule) : "no setting rule", "Program wording": spec?.sourceText ?? r.sourceText ?? "", "Interpretation status": spec?.status ?? "unmapped", "Hours may be mixed": spec?.mixing ?? "unknown", Continuity: spec?.continuity ?? "unknown", "Reviewed by": r.reviewedBy ?? "", "Open questions": (spec?.questions ?? []).join(" | ") };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ruleRows.length ? ruleRows : [{ "Rotation type": "(no rotation types on record)" }]), "Setting rules");
  const reqRows = ledger.requirements.map((r) => ({
    Requirement: r.label, Key: r.key, Scope: r.scopeLabel,
    Version: r.version ? `v${r.version.version} ${r.version.status}` : r.draft ? `v${r.draft.version} draft (unpublished)` : "no version",
    Quantity: r.version?.quantity ?? "", Unit: r.version?.unit ?? "", Basis: r.version?.basis ?? "",
    "Setting rule": r.version?.settingRule ? describeRule(r.version.settingRule.rule) : "", "Rule status": r.version?.settingRule?.status ?? "",
    "Supervision": r.version?.supervision ? `${r.version.supervision.mode} (${r.version.supervision.status})` : "",
    "Source authority": r.version?.sourceAuthority ?? "", "Interpretation": r.version?.interpretationStatus ?? "", "Reviewed by": r.version?.reviewedBy ?? "",
    "Represented in the design": r.represented ?? "", Unresolved: r.unresolved ?? "",
    Note: "Published here means approved for planning inside Rosie — not regulatory approval.",
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reqRows.length ? reqRows : [{ Requirement: "(no structured requirements yet — run the backfill or add one on Design & sequence)" }]), "Requirements");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const safeName = `${program.institution?.shortName ?? program.institution?.name ?? "Rosie"}_${program.name}`.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeName}_program_structure.xlsx"`,
    },
  });
}
