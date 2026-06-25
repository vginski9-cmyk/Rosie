// Crawl the running (DEMO, basePath=/rosie) Next server into a static folder
// for GitHub Pages. Server actions / API won't work on the static host — this is
// a VIEW-ONLY snapshot — but every screen renders with real seeded data and the
// client-side bits (charts, the capacity slider, drag-and-drop) still work.
import { mkdirSync, writeFileSync, cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { PrismaClient } from "@prisma/client";

const PORT = process.env.DEMO_PORT || "4100";
const BASE = `http://localhost:${PORT}`;
const BASEPATH = process.env.PAGES_BASE_PATH || "/rosie";
const OUT = "out";

const prisma = new PrismaClient();

async function routes() {
  const [programs, skills, profiles, courses, students, cohorts] = await Promise.all([
    prisma.program.findMany({ select: { id: true } }),
    prisma.skill.findMany({ select: { id: true } }),
    prisma.wblProfile.findMany({ select: { id: true } }),
    prisma.course.findMany({ select: { id: true } }),
    prisma.student.findMany({ select: { id: true } }),
    prisma.cohort.findMany({ select: { id: true, programId: true } }),
  ]);
  const r = ["/", "/skills", "/wbl", "/programs/new"];
  for (const p of programs) {
    r.push(`/programs/${p.id}`, `/programs/${p.id}/flow`, `/programs/${p.id}/schedule`, `/programs/${p.id}/plan`, `/programs/${p.id}/structure`, `/programs/${p.id}/sequencer`, `/programs/${p.id}/students`, `/programs/${p.id}/wbl`);
  }
  for (const c of cohorts) r.push(`/programs/${c.programId}/offerings/${c.id}`, `/programs/${c.programId}/offerings/${c.id}/schedule`);
  for (const co of courses) r.push(`/courses/${co.id}`);
  for (const s of skills) r.push(`/skills/${s.id}`);
  for (const w of profiles) r.push(`/wbl/${w.id}`);
  for (const st of students) r.push(`/students/${st.id}`);
  return r;
}

async function save(route, html) {
  const rel = route === "/" ? "index.html" : `${route.replace(/^\//, "")}/index.html`;
  const file = join(OUT, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}

const main = async () => {
  const r = await routes();
  console.log(`Crawling ${r.length} routes from ${BASE}${BASEPATH} …`);
  for (const route of r) {
    const res = await fetch(`${BASE}${BASEPATH}${route === "/" ? "/" : route}`, { headers: { Accept: "text/html" } });
    if (!res.ok) {
      console.warn(`  ! ${route} → HTTP ${res.status}`);
      continue;
    }
    await save(route, await res.text());
  }
  // Copy build assets so /rosie/_next/* resolves on Pages.
  if (existsSync(".next/static")) cpSync(".next/static", join(OUT, "_next/static"), { recursive: true });
  writeFileSync(join(OUT, ".nojekyll"), "");
  // SPA-ish fallback so unknown deep links don't hard-404.
  if (existsSync(join(OUT, "index.html"))) cpSync(join(OUT, "index.html"), join(OUT, "404.html"));
  console.log(`Done. Static demo written to ./${OUT}`);
  await prisma.$disconnect();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
