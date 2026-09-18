// Regenerate docs/glossary.md from src/lib/glossary.ts:  npm run glossary
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { glossaryMarkdown } from "../src/lib/glossary";

const out = join(__dirname, "..", "docs", "glossary.md");
writeFileSync(out, glossaryMarkdown());
console.log(`wrote ${out}`);
