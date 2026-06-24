// KSA / curriculum-coverage engine.
//
// A program sets a graduate proficiency BENCHMARK for each skill (the level a
// completer should reach). Courses each develop skills to some level and mark
// whether they introduce / reinforce / master them. This engine answers: does
// the curriculum actually get students to the benchmark, and where are the gaps?
// Pure (no DB) so it is easy to test and reuse client- or server-side.

export type CoverageStatus = "MET" | "BELOW" | "NOT_TAUGHT";
export type CurriculumRole = "INTRODUCED" | "REINFORCED" | "MASTERED";

export interface ProgramBenchmark {
  skillId: string;
  skillName: string;
  skillType?: string;
  targetLevel: number; // graduate benchmark
  priority?: string | null; // core | supporting
}

export interface CourseDevelopment {
  skillId: string;
  courseId: string;
  courseName: string;
  termIndex: number;
  targetLevel: number; // level the course develops the skill to
  role?: CurriculumRole | string | null;
}

export interface SkillCoverage {
  skillId: string;
  skillName: string;
  skillType?: string;
  targetLevel: number;
  priority?: string | null;
  /** Highest level any course develops this skill to. */
  reachedLevel: number;
  status: CoverageStatus;
  /** Gap = targetLevel - reachedLevel (0 if met). */
  gap: number;
  /** Courses developing this skill, ordered by term. */
  contributingCourses: CourseDevelopment[];
}

export interface CoverageSummary {
  total: number;
  met: number;
  below: number;
  notTaught: number;
  /** Fraction of benchmarks fully met (0–1). */
  coverageRate: number;
  /** Same, restricted to `priority === "core"` skills. */
  coreCoverageRate: number;
  skills: SkillCoverage[];
}

export function analyzeCoverage(
  benchmarks: ProgramBenchmark[],
  development: CourseDevelopment[],
): CoverageSummary {
  const skills: SkillCoverage[] = benchmarks.map((b) => {
    const contributing = development
      .filter((d) => d.skillId === b.skillId)
      .sort((a, c) => a.termIndex - c.termIndex);
    const reachedLevel = contributing.reduce((max, d) => Math.max(max, d.targetLevel), 0);
    let status: CoverageStatus;
    if (contributing.length === 0) status = "NOT_TAUGHT";
    else if (reachedLevel >= b.targetLevel) status = "MET";
    else status = "BELOW";
    return {
      skillId: b.skillId,
      skillName: b.skillName,
      skillType: b.skillType,
      targetLevel: b.targetLevel,
      priority: b.priority ?? null,
      reachedLevel,
      status,
      gap: Math.max(0, b.targetLevel - reachedLevel),
      contributingCourses: contributing,
    };
  });

  const met = skills.filter((s) => s.status === "MET").length;
  const below = skills.filter((s) => s.status === "BELOW").length;
  const notTaught = skills.filter((s) => s.status === "NOT_TAUGHT").length;
  const core = skills.filter((s) => s.priority === "core");
  const coreMet = core.filter((s) => s.status === "MET").length;

  return {
    total: skills.length,
    met,
    below,
    notTaught,
    coverageRate: skills.length ? met / skills.length : 0,
    coreCoverageRate: core.length ? coreMet / core.length : 1,
    skills,
  };
}

export type AssessmentStatus = "ASSESSED" | "UNDER" | "UNASSESSED";

export interface SkillAssessment {
  skillId: string;
  skillName: string;
  priority?: string | null;
  targetLevel: number;
  /** Highest level any session assesses this skill to (0 = none). */
  assessedLevel: number;
  status: AssessmentStatus;
}

export interface AssessmentAnalysis {
  skills: SkillAssessment[];
  coreCount: number;
  coreAssessedToTarget: number;
  /** Share of core benchmarks assessed AT OR ABOVE their target level (0–1).
   *  This is the competency gate the completion/licensure projection rides on. */
  competencyReadiness: number;
}

/**
 * Loop 1 — assessment → completion. A benchmark you never assess (or assess
 * below target) cannot be validly certified at graduation. This grades each
 * benchmark against the levels actually assessed (SessionSkill ASSESS/BOTH) and
 * yields a competency-readiness score that modulates projected completion.
 */
export function analyzeAssessment(benchmarks: ProgramBenchmark[], assessedLevels: Record<string, number>): AssessmentAnalysis {
  const skills: SkillAssessment[] = benchmarks.map((b) => {
    const assessedLevel = assessedLevels[b.skillId] ?? 0;
    let status: AssessmentStatus;
    if (assessedLevel <= 0) status = "UNASSESSED";
    else if (assessedLevel >= b.targetLevel) status = "ASSESSED";
    else status = "UNDER";
    return { skillId: b.skillId, skillName: b.skillName, priority: b.priority ?? null, targetLevel: b.targetLevel, assessedLevel, status };
  });
  const core = skills.filter((s) => s.priority === "core");
  const pool = core.length ? core : skills;
  const assessedToTarget = pool.filter((s) => s.status === "ASSESSED").length;
  return {
    skills,
    coreCount: pool.length,
    coreAssessedToTarget: assessedToTarget,
    competencyReadiness: pool.length ? assessedToTarget / pool.length : 1,
  };
}

/**
 * Projected fully-competent completers: the funnel's "completing" figure scaled
 * by competency readiness. If only 60% of core competencies are assessed to
 * target, the defensible completion count is 60% of plan.
 */
export function competencyAdjustedCompletion(baseCompleting: number, readiness: number): number {
  return baseCompleting * readiness;
}

export interface AssessmentCoverage {
  benchmarked: number;
  assessed: number;
  assessmentRate: number;
  /** Benchmarked skills with no session that assesses them — a measurement gap. */
  unassessed: { skillId: string; skillName: string }[];
}

/**
 * Closes the skills loop: a skill can be TAUGHT (curriculum) yet never ASSESSED.
 * Given the set of skill ids that some session assesses, report which graduate
 * benchmarks actually have an assessment behind them.
 */
export function assessmentCoverage(benchmarks: ProgramBenchmark[], assessedSkillIds: Set<string>): AssessmentCoverage {
  const unassessed = benchmarks.filter((b) => !assessedSkillIds.has(b.skillId)).map((b) => ({ skillId: b.skillId, skillName: b.skillName }));
  const assessed = benchmarks.length - unassessed.length;
  return {
    benchmarked: benchmarks.length,
    assessed,
    assessmentRate: benchmarks.length ? assessed / benchmarks.length : 1,
    unassessed,
  };
}
