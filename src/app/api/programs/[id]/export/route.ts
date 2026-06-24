import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { getProgramFull, getProgramArchetype } from "@/lib/queries";
import { programDemand } from "@/lib/capacity";
import { analyzeFunnel, type StageKey } from "@/lib/funnel";
import { analyzeCoverage, type ProgramBenchmark, type CourseDevelopment } from "@/lib/ksa";

export const runtime = "nodejs";

const ATTRITION = [1.0, 0.94, 0.88, 0.82, 0.76, 0.7];

/** Excel-out: a workbook with the program's funnel, capacity, and KSA coverage. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const program = await getProgramFull(params.id);
  if (!program) return new Response("Not found", { status: 404 });
  const archetype = await getProgramArchetype(params.id);

  const enrollment = Number(new URL(req.url).searchParams.get("enrollment")) || Math.round(program.yearTargets.find((t) => t.cohortCapacity)?.cohortCapacity ?? 40);

  const wb = XLSX.utils.book_new();

  // --- Funnel sheet ---
  const cohort = program.cohorts[0];
  if (cohort) {
    const analysis = analyzeFunnel(
      cohort.stages.map((s) => ({ key: s.stageKey as StageKey, label: s.label, target: s.targetNumber, actual: s.actualNumber })),
    );
    const rows = analysis.map((a) => ({
      Stage: a.label,
      Target: a.target ?? "",
      Actual: a.actual ?? "",
      "Plan conversion": a.targetConversion != null ? +(a.targetConversion * 100).toFixed(1) : "",
      "Actual conversion": a.actualConversion != null ? +(a.actualConversion * 100).toFixed(1) : "",
      "Attainment %": a.attainment != null ? +(a.attainment * 100).toFixed(1) : "",
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
    "Faculty FTE": +td.totals.facultyFTE.toFixed(2),
    Preceptors: td.totals.preceptorInstances,
    "Room-hours": td.totals.roomHours,
  }));
  capRows.push({
    Term: "PROGRAM TOTAL",
    Enrolled: "" as unknown as number,
    "Class sections": demand.totals.classSections,
    "Lab sections": demand.totals.labSections,
    "Clinical / WBL slots": demand.totals.clinicalSections,
    "Faculty FTE": +demand.totals.facultyFTE.toFixed(2),
    Preceptors: demand.totals.preceptorInstances,
    "Room-hours": demand.totals.roomHours,
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(capRows), "Capacity");

  // --- KSA coverage sheet ---
  const benchmarks: ProgramBenchmark[] = program.programSkills.map((ps) => ({
    skillId: ps.skillId,
    skillName: ps.skill.name,
    skillType: ps.skill.type,
    targetLevel: ps.targetLevel,
    priority: ps.priority,
  }));
  const development: CourseDevelopment[] = program.terms.flatMap((t) =>
    t.courses.flatMap((c) => c.courseSkills.map((cs) => ({ skillId: cs.skillId, courseId: c.id, courseName: c.code ?? c.name, termIndex: t.index, targetLevel: cs.targetLevel, role: cs.role ?? undefined })),
    ),
  );
  const coverage = analyzeCoverage(benchmarks, development);
  const ksaRows = coverage.skills.map((s) => ({
    Skill: s.skillName,
    Type: s.skillType,
    Priority: s.priority ?? "",
    "Graduate benchmark": s.targetLevel,
    "Curriculum reaches": s.reachedLevel,
    Status: s.status,
    Gap: s.gap,
    "Developed by": s.contributingCourses.map((c) => c.courseName).join(", "),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ksaRows.length ? ksaRows : [{ Note: "No skills mapped yet" }]), "KSA Coverage");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const safeName = program.name.replace(/[^a-z0-9]+/gi, "_");
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Rosie_${safeName}.xlsx"`,
    },
  });
}
