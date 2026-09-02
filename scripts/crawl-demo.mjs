// Crawl the running (DEMO, basePath=/rosie) Next server into a static folder
// for GitHub Pages. Server actions / API won't work on the static host — this is
// a VIEW-ONLY snapshot — but every screen renders with real seeded data and the
// client-side bits (charts, the capacity slider, drag-and-drop) still work.
//
// Pages are discovered by following every same-site link from a seed list, so
// new routes are picked up without editing this file.
import { mkdirSync, writeFileSync, cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const PORT = process.env.DEMO_PORT || "4100";
const BASE = `http://localhost:${PORT}`;
const BASEPATH = process.env.PAGES_BASE_PATH || "/rosie";
const OUT = "out";
const MAX_PAGES = Number(process.env.DEMO_MAX_PAGES || 1500);

const SEEDS = ["/", "/calendar", "/insights", "/insights/staffing-need", "/insights/coverage", "/insights/clinical-sites", "/semester", "/students", "/people", "/employers", "/facilities", "/courses", "/wbl", "/programs/new"];

function save(route, html) {
  const rel = route === "/" ? "index.html" : `${route.replace(/^\//, "").replace(/\/$/, "")}/index.html`;
  const file = join(OUT, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}

/** Same-site page links in a rendered page, as app routes (basePath stripped). */
function linksIn(html) {
  const out = new Set();
  for (const m of html.matchAll(/href="([^"#?]+)(?:[?#][^"]*)?"/g)) {
    let h = m[1];
    if (h.startsWith("http")) { try { const u = new URL(h); if (u.host !== `localhost:${PORT}`) continue; h = u.pathname; } catch { continue; } }
    if (!h.startsWith(BASEPATH + "/") && h !== BASEPATH) continue;
    const route = h.slice(BASEPATH.length) || "/";
    if (route.startsWith("/_next") || route.startsWith("/api") || route === "/login" || /\.[a-z0-9]+$/i.test(route)) continue;
    out.add(route.replace(/\/$/, "") || "/");
  }
  return out;
}

const main = async () => {
  const seen = new Set(SEEDS);
  const queue = [...SEEDS];
  let saved = 0, failed = 0;
  console.log(`Crawling from ${BASE}${BASEPATH} …`);
  while (queue.length && saved + failed < MAX_PAGES) {
    const route = queue.shift();
    const res = await fetch(`${BASE}${BASEPATH}${route === "/" ? "/" : route}`, { headers: { Accept: "text/html" } });
    if (!res.ok) { failed++; console.warn(`  ! ${route} → HTTP ${res.status}`); continue; }
    const html = await res.text();
    save(route, html); saved++;
    for (const l of linksIn(html)) if (!seen.has(l)) { seen.add(l); queue.push(l); }
  }
  // Copy build assets so /rosie/_next/* resolves on Pages.
  if (existsSync(".next/static")) cpSync(".next/static", join(OUT, "_next/static"), { recursive: true });
  // GitHub Pages serves 404.html for unknown paths — point people back home.
  writeFileSync(join(OUT, "404.html"), `<!doctype html><meta charset="utf-8"><title>Rosie</title><meta http-equiv="refresh" content="0;url=${BASEPATH}/"><p>Redirecting to <a href="${BASEPATH}/">Rosie</a>…</p>`);
  writeFileSync(join(OUT, ".nojekyll"), "");
  console.log(`Done. ${saved} pages written to ./${OUT}${failed ? ` (${failed} failed)` : ""}.`);
};

main().catch((e) => { console.error(e); process.exit(1); });
