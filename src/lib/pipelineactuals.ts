// The talent-pipeline ACTUALS of an offering, read from its learner records —
// never typed in beside the targets. Every person who applied to the offering
// or enrolled in it is counted at every stage they reached: a prospect at
// "interested"; an applicant at "interested" and "qualified"; someone enrolled at
// the four stages down to "enrolled"; someone who later withdrew still counts as
// having enrolled (that is where the leak shows). Stages nobody has reached yet
// and that lie beyond the furthest stage anyone has reached stay blank, not zero.

import { prisma } from "./db";
import { STAGES, STAGE_INDEX, type StageKey } from "./funnel";

const STATUS_STAGE: Record<string, StageKey | null> = {
  prospect: "interested", applicant: "qualified", admitted: "offered", enrolled: "enrolled",
  completed: "completing", licensed: "licensed", placed: "placed", productive: "productive", withdrawn: null,
};

/** The furthest funnel stage a learner record has reached (index into STAGES), or -1. */
export function reachedIndex(s: { status: string; stageKey: string | null; cohortId: string | null }): number {
  const key = (s.stageKey && s.stageKey in STAGE_INDEX ? (s.stageKey as StageKey) : null) ?? STATUS_STAGE[s.status] ?? null;
  if (key) return STAGE_INDEX[key];
  // Withdrawn: they had enrolled if they sat in the offering, else they had at least applied.
  if (s.status === "withdrawn") return s.cohortId ? STAGE_INDEX.enrolled : STAGE_INDEX.qualified;
  return -1;
}

/** Stage counts for a set of learner records: how many reached each stage. */
export function stageActuals(records: { status: string; stageKey: string | null; cohortId: string | null }[]): Record<StageKey, number | null> {
  const reached = records.map(reachedIndex);
  const furthest = Math.max(-1, ...reached);
  const out = {} as Record<StageKey, number | null>;
  for (const st of STAGES) { const i = STAGE_INDEX[st.key]; out[st.key] = i <= furthest ? reached.filter((r) => r >= i).length : null; }
  return out;
}

/** Recompute and store an offering's stage actuals from its learner records. */
export async function syncCohortActuals(cohortId: string): Promise<Record<StageKey, number | null>> {
  const records = await prisma.student.findMany({ where: { OR: [{ cohortId }, { applicationCohortId: cohortId }] }, select: { status: true, stageKey: true, cohortId: true } });
  const actuals = stageActuals(records);
  const stages = await prisma.funnelStage.findMany({ where: { cohortId }, select: { id: true, stageKey: true } });
  for (const st of stages) {
    if (!(st.stageKey in actuals)) continue;
    await prisma.funnelStage.update({ where: { id: st.id }, data: { actualNumber: actuals[st.stageKey as StageKey] } });
  }
  return actuals;
}

/** Resync every offering a learner touches (their application and their enrollment). */
export async function syncActualsForStudent(studentId: string): Promise<void> {
  const s = await prisma.student.findUnique({ where: { id: studentId }, select: { cohortId: true, applicationCohortId: true } });
  for (const id of new Set([s?.cohortId, s?.applicationCohortId].filter((x): x is string => !!x))) await syncCohortActuals(id);
}
