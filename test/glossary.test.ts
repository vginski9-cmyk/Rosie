import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { GLOSSARY, GLOSSARY_TERMS, glossaryMarkdown } from "../src/lib/glossary";

// Phase 2 (docs/metrics-audit.md): one term per concept, the doc generated from the source,
// and the retired synonyms gone from what a user reads.

const ROOT = join(__dirname, "..");
function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) out.push(...tsxFiles(p)); else if (p.endsWith(".tsx")) out.push(p); }
  return out;
}
/** The user-facing strings of a file: JSX text and string/template literals, comments stripped. */
function visibleText(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the glossary (Phase 2)", () => {
  it("defines the concepts the audit named, once each", () => {
    const keys = GLOSSARY_TERMS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of ["program-family", "program", "offering", "cohort", "session", "section", "section-booking", "shift", "learner-shift", "asset-booking", "student-attendance", "clinical-placement", "employment-placement", "fte", "required-count"]) expect(keys).toContain(k);
    expect(GLOSSARY.length).toBeGreaterThan(3);
  });
  it("docs/glossary.md is generated from the source (run `npm run glossary` after editing src/lib/glossary.ts)", () => {
    expect(readFileSync(join(ROOT, "docs", "glossary.md"), "utf8")).toBe(glossaryMarkdown());
  });
  it("the retired synonyms no longer appear in what a user reads", () => {
    const retired: [RegExp, string][] = [
      [/\binstantiations?\b/i, "instantiation → offering"],
      [/\bdelivery[- ]models?\b/i, "delivery model → program"],
      [/\bsection-meetings?\b/i, "section-meeting → shift"],
      [/\bsection-shifts?\b/i, "section-shift → shift"],
      [/(?<!clinical )\bplacements? coordinators?\b/i, "placement coordinator → clinical placement coordinator"],
    ];
    const files = ["src/components", "src/app"].flatMap((d) => tsxFiles(join(ROOT, d)));
    const hits: string[] = [];
    for (const f of files) {
      const text = visibleText(readFileSync(f, "utf8"));
      for (const [re, why] of retired) { const m = re.exec(text); if (m) hits.push(`${relative(ROOT, f)}: "${m[0]}" (${why})`); }
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });
});
