import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// One cohort rule (lib/cohortscope): every offering that is not archived is a record — planned, running or
// graduated. No query, page or action may drop a graduated class by status; a forward-looking surface narrows
// by date. This check fails when the old status filters come back anywhere under src/ or prisma/.
const ROOT = join(__dirname, "..");
const DIRS = ["src", "prisma", "scripts"];
const FORBIDDEN: { re: RegExp; why: string }[] = [
  { re: /status:\s*\{\s*in:\s*\[\s*"planned",\s*"active"\s*\]\s*\}/, why: "a planned+active cohort filter drops graduated classes — use NOT_ARCHIVED and narrow by date" },
  { re: /status:\s*\{\s*in:\s*\[\s*"enrolled",\s*"admitted"\s*\]\s*\}/, why: "an enrolled+admitted roster drops graduates — use ROSTER_STATUSES" },
  { re: /status:\s*\{\s*in:\s*\[\s*"enrolled",\s*"completed",\s*"placed"\s*\]\s*\}/, why: "this roster drops licensed and productive graduates — use ENROLLED_AND_BEYOND" },
];
const ALLOW = new Set<string>(["test/cohortscope-lint.test.ts"]);

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "node_modules" && name !== ".next") out.push(...files(p)); }
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

describe("one cohort rule: no status filter drops a graduated class", () => {
  it("no forbidden cohort or roster status filter remains", () => {
    const hits: string[] = [];
    for (const dir of DIRS) for (const f of files(join(ROOT, dir))) {
      const rel = relative(ROOT, f); if (ALLOW.has(rel)) continue;
      const src = readFileSync(f, "utf8");
      for (const { re, why } of FORBIDDEN) { const m = src.match(re); if (m) hits.push(`${rel}: ${m[0]} — ${why}`); }
    }
    expect(hits).toEqual([]);
  });
});
