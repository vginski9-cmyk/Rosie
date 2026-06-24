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
