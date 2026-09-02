"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// First-open walkthrough. The first time anyone opens a page, a short guided
// tour explains what the page is, what everything on it means, and how to do
// things. Dismissing it remembers per page (localStorage); the floating "?"
// reopens the tour any time.

interface Step { h: string; b: string }
interface Tour { key: string; match: RegExp; title: string; steps: Step[] }

const TOURS: Tour[] = [
  {
    key: "home", match: /^\/$/, title: "North Star — the whole platform in one row",
    steps: [
      { h: "One card per job the region needs", b: "Each card is a job — Radiologic Technologists, Surgical Technologists, Medical Assistants. Click one to set its goal." },
      { h: "The simple workflow", b: "1) Set a goal for the job. 2) Drag a prepopulated program template in with a start date. 3) Lock it in — the instantiation is created with real term dates and every pipeline target. 4) Open Insights to see the clinical capacity it needs and whether the sites in supply can absorb it." },
      { h: "Everything is connected", b: "Goals set targets → targets size cohorts → cohorts schedule sessions → sessions demand instructors, preceptors and clinical sites. Change any link and every other surface updates." },
    ],
  },
  {
    key: "family", match: /^\/families\/[^/]+$/, title: "The goal page — set it, then break it down",
    steps: [
      { h: "The academic calendar, imported", b: "Paste the college's calendar (from its web page, its PDF, or a spreadsheet) into the Academic calendar drop-down — semester starts, ends, later sessions and every holiday / break are coded automatically; fix any line, save. Every offering's term dates follow the real dates, and sessions that land on a break are flagged." },
      { h: "The goal row", b: "One box per year, reading left to right — the stairstep of fully-productive workers this family owes the region. Type in a box to change that year's goal; + adds a year before the first or after the last, × removes one." },
      { h: "Click a year", b: "Below the row you get that year's talent-pipeline health targets (the editable % ladder) and the talent-pipeline target metrics for cohorts ending that year — goal vs actual, live from student records." },
      { h: "Who delivers the goal", b: "Drag prepopulated program templates into the box to say which instantiations are responsible — the evening class covers 15, the traditional program covers the rest. Each template shows its max cohort enrollment capacity; if the math needs more seats than a cohort can hold, the box flags it." },
      { h: "Set dates and lock it in", b: "Give each allocation a start date (the stop date derives from the template's term structure), tune per-term enrollment if you like, then Lock in — that creates the real offering with term dates and the full set of pipeline targets. It appears under the year immediately." },
      { h: "Fluid offerings", b: "The offering count is a suggestion, not a cage: ± offering adds or removes runs (each takes an equal share of the goal), ✕ drops an unlocked slot, and 🔓 Unlock undoes a lock-in — the instantiation is deleted, students are detached, and the slot is yours to re-sequence." },
    ],
  },
  {
    key: "design", match: /^\/families\/[^/]+\/design$/, title: "Program design & pathways",
    steps: [
      { h: "Delivery models", b: "Each card is a credential + term structure (a template) — the 5-term day program, the evening track. Click Design to open its full course-and-session designer." },
      { h: "Offerings under each model", b: "The chips under each model are its scheduled instantiations. Click one to see its calendar, staffing, students and WBL — and how it performs against its targets." },
    ],
  },
  {
    key: "program", match: /^\/programs\/[^/]+$/, title: "A delivery model (template)",
    steps: [
      { h: "Template vs offerings", b: "This page is the timeless template. The scheduled offerings at the top are its real runs — each links into its schedule and staffing. Pipeline analytics live on each offering, where the real targets are." },
    ],
  },
  {
    key: "structure", match: /^\/programs\/[^/]+\/structure$/, title: "Design & sequence — the Raw Data & Calculations sheet",
    steps: [
      { h: "Drop in the spreadsheet you already have", b: "The dashed box takes an Excel / CSV file or pasted cells — the workbook's own headers or everyday ones. Columns are recognized, blank term / course cells fill down, sessions are numbered, days and times normalized; check the mapping, import, then edit anything." },
      { h: "One row per session — every column, full names", b: "Every class, lab and clinical session of every course. Click a row: all workbook columns A–AE with their full headers — Session Delivery Mode, Session Location, Max number of students that ONE session can accommodate, Number of faculty required, contact hour policies, week, day, notes, preceptors, Clinical Rotation Type, Clinical Mode. Drop-downs where there's a choice; every drop-down takes a new option. Blue = input, green = live formula." },
      { h: "The math chain", b: "Sections = ROUNDUP(enrollment ÷ max per session). Space hours = length × sections. Faculty contact hours = length × faculty × sections, then ÷ the workload assumptions for semesterly and weekly. Preceptors: sections × preceptors × length × policy." },
      { h: "Workload assumptions", b: "The card up top holds the divisor cells (full-time contact hours, work week, weeks in term) for faculty and preceptors — change them and every conversion on this page and in Insights shifts." },
      { h: "Run test figures", b: "Drag the enrollment slider and watch the whole chain recompute — then open Insights → Instructors & preceptors, Clinical sites, or Daily coverage to see the same numbers land on real weeks, sites and dates." },
      { h: "Re-sequence", b: "Use ⇄ Re-sequence to drag courses between terms. Term assignment drives the calendar of every offering — move a course and every schedule shifts with it." },
    ],
  },
  {
    key: "offering-design", match: /^\/programs\/[^/]+\/offerings\/[^/]+\/design$/, title: "Design & sequence — this instantiation",
    steps: [
      { h: "In the order it actually happens", b: "Sessions are sorted by week → day → time, classes, labs and clinicals interleaved — the real timeline, with the actual date on every row. Holiday collisions are flagged in red so you can move them." },
      { h: "The template's exact sheet, at THIS offering's enrollment", b: "The same Raw Data & Calculations columns (A–AE) as the template page — but column C is this offering's per-term enrollment target, so sections, space hours, and faculty & preceptor contact-hour formulas show what this run actually needs. Each term's target and its total need sit in the card above its courses." },
      { h: "Every cell is editable — for THIS offering", b: "Title, delivery, location, length, capacity, staffing counts, policies, rotation, week, day, time, notes — the same configurability as the template sheet. Formula columns recalculate as you type; Save row stores only what differs from the template ('edited' chip; clear returns to it)." },
      { h: "Edit the weekly pattern", b: "Each course × kind has a weekly booking (day · time · room or partner site · staff). Click edit, change it, save — the same booking updates on the master calendar and every other surface." },
      { h: "Course windows drive the dates", b: "Set a course's own start and end dates on its card in the sequence board (offering page) and every session row here re-anchors — an 8-week course inside a 16-week term shows its real dates, staffing and holiday flags." },
    ],
  },
  {
    key: "offering", match: /^\/programs\/[^/]+\/offerings\/[^/]+$/, title: "A scheduled offering",
    steps: [
      { h: "This is reality", b: "The template instantiated: real dates, real pipeline targets, real people. Adjust the offering's start date and each term's first day right here — everything re-derives." },
      { h: "One clear button per section", b: "Talent pipeline (with enrollment through every term inside the funnel), Offering dates, Preferred course sequence, Instructors & preceptors, and Calendar — each is a drop-down: the button shows the live summary, clicking opens the full picture." },
      { h: "Configure the instantiation", b: "Open Design & sequence — this offering to edit every session for this run. In the sequence board, each course card carries its OWN start and end date inputs — 8-week and 16-week courses inside the same term each get their real window, and session dates, staffing and the calendar all shift with it." },
      { h: "The calendar", b: "Scroll the month view with ← → : every session on its exact date, color-coded (blue class, violet lab, rose clinical) with time, course and location. Click a day to see exactly what happens that day and who must be on site; ⚠ marks holiday collisions." },
    ],
  },
  {
    key: "students", match: /^\/programs\/[^/]+\/students$/, title: "The roster",
    steps: [
      { h: "The pipeline, by name", b: "Every student with their stage, status, GPA and attendance. Click a student for their complete record — grades, attendance, WBL placements." },
    ],
  },
  {
    key: "calendar", match: /^\/calendar/, title: "Master calendar",
    steps: [
      { h: "Every room and site, one grid", b: "All programs' meetings across campus rooms AND clinical partner sites, week by week. Colors are programs; the strip at a partner name is a clinical rotation hosted there." },
      { h: "Move things here", b: "Click a meeting to change its day, time, room or staff — the offering's calendar updates instantly, and conflicts (room, staff, section) surface in the panel." },
      { h: "Utilization", b: "The rail shows each room's peak-week booked hours against its open hours — where space is tight and where it idles." },
    ],
  },
  {
    key: "staffing-need", match: /^\/insights\/staffing-need/, title: "Instructors & preceptors needed",
    steps: [
      { h: "The answer, in words", b: "Each altitude opens with a plain statement — we need N instructors and M preceptors in this semester / week / day, at these times — then the charts behind it." },
      { h: "The pivot charts", b: "FTEs per semester (year → semester → class/lab/clinical — the budgeting view), FTEs per week of term (the shape of the load; where orange overtakes blue, clinicals start), and clinical staffing by rotation type — every column carries its number, blue = faculty, orange = preceptors." },
      { h: "Every shift is a column", b: "The shift chart plays out every session instance — one vertical column per shift group, height = shift length, color = class / lab / clinical — capped with its hours × shifts and the people who staff it, grouped day by day under week headers, term by term." },
      { h: "The staffing plan by term", b: "Peak simultaneous need per term, in whole people — hand it to scheduling." },
      { h: "Filters", b: "Every workbook page filter: cohorts, terms, session type, course code, delivery mode, rotation type, clinical mode, day, and a date range — they never remove data from the model, only from the view." },
    ],
  },
  {
    key: "clinical-sites", match: /^\/insights\/clinical-sites/, title: "Clinical sites",
    steps: [
      { h: "Verdict by setting", b: "Supply is the clinical asset map — every site's functional units (beds, ORs, stations) with their shift blocks, days open and students per shift. Demand is every dated clinical section, mapped from rotation type to unit category. Each setting gets a verdict: covered by SECURED sites, room exists but not secured, or not enough physical room." },
      { h: "Day grid, gaps, assignment", b: "The Day grid shows students each category can host by weekday × Day/Evening/Night block (secured first, physical in parentheses). Gaps by date lists every date-block where demand exceeds secured supply. Assign sections puts each clinical section at a site + unit; Sites & agreements tracks who is prospect / asked / secured." },
      { h: "One request block per setting", b: "For each clinical rotation type: students on the heaviest day, hosted shifts, preceptor hours, the days of week, and the calendar window — exactly what to ask a site to host." },
      { h: "Month by month", b: "The table shows the hosted load each setting carries per month, so a site can see its whole year at a glance." },
    ],
  },
  {
    key: "coverage", match: /^\/insights\/coverage/, title: "Daily coverage",
    steps: [
      { h: "Four altitudes", b: "Semester shows every week of every term at a glance; Month and Week put one chip per SHIFT on the grid (16 sections = 16 chips, §2 = section 2), color-coded class / lab / clinical; Day lists every shift individually. Click any day number or cell to drop into the Day view." },
      { h: "Drag a shift", b: "Space is fluid: drag any chip onto another day (Month or Week view) and that section's weekly booking moves — the master calendar, staffing and coverage all update instantly." },
      { h: "Edit a shift exactly", b: "In the Day view every shift has its weekday, time, room or clinical site, and instructor / preceptor editable in place — and the day's numbers are explained: shifts = sessions × sections, students counted once even when they rotate through several sessions." },
      { h: "The schedule for sites", b: "Below, every date with what arrives and how many preceptors need to be on site — the list you hand to clinical partners." },
    ],
  },
  {
    key: "insights", match: /^\/insights$/, title: "Explore",
    steps: [
      { h: "Build any slice", b: "Pick rows, columns and a measure over the institution-wide fact table — pipeline and delivery metrics per cohort, term and stage." },
    ],
  },
  {
    key: "semester", match: /^\/semester/, title: "Semester view",
    steps: [{ h: "Who's in session", b: "Every cohort in a given semester — what term they're in, their courses, and their headcounts." }],
  },
  {
    key: "courses", match: /^\/courses$/, title: "Shared course demand",
    steps: [{ h: "Cross-program sections", b: "Courses several programs need, with combined headcount — how big those sections actually have to be." }],
  },
  {
    key: "directory", match: /^\/(students|people|employers|facilities)$/, title: "Directory",
    steps: [{ h: "The people and places", b: "Students, faculty & staff, employer partners and facilities — every entity the planning surfaces reference, with live workload and capacity where it applies." }],
  },
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
    try {
      if (!localStorage.getItem(LS_PREFIX + tour.key)) setOpen(true);
      else setOpen(false);
    } catch { setOpen(false); }
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
