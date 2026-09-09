"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// Page guide. Never opens on its own — the floating "?" opens a short tour of
// the page you are on.

interface Step { h: string; b: string }
interface Tour { key: string; match: RegExp; title: string; steps: Step[] }

const TOURS: Tour[] = [
  { key: "home", match: /^\/$/, title: "Home", steps: [
    { h: "In the order the work happens", b: "1 · Set the institution up once (calendar, rooms, people, policies). 2 · For each program: design it, set up its clinical sites, run offerings, follow the students. 3 · Read what it adds up to under Insights." },
  ] },
  { key: "program", match: /^\/programs\/[^/]+$/, title: "A program", steps: [
    { h: "One tab per job to do", b: "Overview lists the offerings that run this program. Design & sequence is the template. Clinical sites & requirements is the program's network. Goal & pipeline is the multi-year North Star. Students is the roster." },
  ] },
  { key: "structure", match: /^\/programs\/[^/]+\/structure$/, title: "Design & sequence", steps: [
    { h: "One row per course", b: "Every course is one closed row: code, hours per week, session counts, clinical settings, and what it costs at the planned enrollment. Open a row to edit its sessions — every class, lab and clinical with its length, capacity, staffing, day and time." },
    { h: "The roll-up below", b: "How the clinical sequence satisfies the credentialing body's list: which required experiences each course first makes reachable, and the target a student should have logged by the end of each course." },
  ] },
  { key: "clinical", match: /^\/programs\/[^/]+\/clinical$/, title: "Clinical sites & requirements", steps: [
    { h: "What completion requires, then the sites", b: "The list is scored item by item against the sites: who provides each experience, confirmed or only inferred. Open a site to set its agreement, assets and shifts, staff, availability, and what it provides." },
  ] },
  { key: "site", match: /^\/programs\/[^/]+\/clinical\/sites\/[^/]+$/, title: "A site, set up for this program", steps: [
    { h: "Top to bottom", b: "Where it is, the agreement, the accreditor's recognition, the availability agreed, the rooms and shift structures, the qualified staff, and — item by item — which required experiences it provides." },
  ] },
  { key: "offering", match: /^\/programs\/[^/]+\/offerings\/[^/]+$/, title: "An offering", steps: [
    { h: "The template, run for real", b: "Real dates, targets and people. Each section opens: pipeline, term dates, sequence, staffing, completion requirements, rotations, students and the calendar. Design & sequence — this offering edits every session for this run." },
  ] },
  { key: "employer", match: /^\/employers\/[^/]+$/, title: "An organization", steps: [
    { h: "What the site is, regardless of program", b: "Address and drive time, every asset with its shift structure, closures, units, people and placements. What it means to a program is set on that program's clinical pages." },
  ] },
  { key: "insights", match: /^\/(insights|scheduler|supply|utilization|semester)/, title: "Insights", steps: [
    { h: "Every analysis is a tab", b: "Instructors and preceptors needed, daily coverage, the clinical scheduler, clinical site capacity, room utilization, the semester view and the explorer all read the same offerings." },
  ] },
];

const LS_PREFIX = "rosie-tour:";

export function Tutorial() {
  const pathname = usePathname() ?? "";
  const tour = TOURS.find((t) => t.match.test(pathname)) ?? null;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    setStep(0);
    if (!tour) { setOpen(false); return; }
    setOpen(false); // never auto-open — the floating "?" opens the tour on request
  }, [pathname, tour?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tour) return null;

  const done = () => {
    try { localStorage.setItem(LS_PREFIX + tour.key, "1"); } catch { /* private mode */ }
    setOpen(false);
  };

  return (
    <>
      {/* Reopen button */}
      <button
        onClick={() => { setStep(0); setOpen(true); }}
        title="How this page works"
        className="fixed bottom-4 right-4 z-40 flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-sm font-bold text-white shadow-lg hover:bg-rose-600"
      >?</button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" onClick={done}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-rose-600">How this page works · {step + 1} of {tour.steps.length}</div>
                <h2 className="mt-0.5 text-lg font-semibold text-slate-900">{tour.title}</h2>
              </div>
              <button onClick={done} className="text-slate-300 hover:text-slate-600" title="close">✕</button>
            </div>
            <div className="mt-3 min-h-[92px]">
              <h3 className="text-sm font-semibold text-slate-800">{tour.steps[step].h}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{tour.steps[step].b}</p>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <div className="flex gap-1.5">
                {tour.steps.map((_, i) => (
                  <button key={i} onClick={() => setStep(i)} className={`h-1.5 rounded-full transition-all ${i === step ? "w-6 bg-rose-600" : "w-1.5 bg-slate-200 hover:bg-slate-300"}`} title={`step ${i + 1}`} />
                ))}
              </div>
              <div className="flex items-center gap-2">
                {step > 0 && <button onClick={() => setStep(step - 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Back</button>}
                {step < tour.steps.length - 1
                  ? <button onClick={() => setStep(step + 1)} className="rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-rose-700">Next</button>
                  : <button onClick={done} className="rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-rose-700">Got it</button>}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
