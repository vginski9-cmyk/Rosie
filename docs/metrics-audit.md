# Metrics audit (Phase 0)

Read-only audit of the figures three reviewers could not reconcile in the Rosie v0.2 demo.
For each figure: where it is computed, its inputs and filters, the population and date range it
covers, whether another code path computes the same concept independently, and a verdict.

Audited against commit `4111db7` on 2026-09-18, seed reloaded that day (the seed now also carries
Carteret, Lenoir and Roanoke-Chowan; Insights pages default to Sandhills unless "All colleges" is
picked). Reviewer figures came from an earlier seed state, so current values differ; the code
paths are the same.

Verdict key: **bug** · **legitimate difference needing explanation** · **label problem** ·
**could not reproduce**.

## 1. The figures

### 1.1 Scheduler: demanded, placed, staffed, supply, earlier bookings

| Figure (reviewer) | Today | Computed in |
|---|---|---|
| 7,246 learner-shifts demanded | 7,246 | `recommendPlan` summary, `src/lib/scheduler.ts:643` — `demandSeats = Σ unit.seats` |
| 7,041 placed | 4,420 (61%) | `:644` — `placedSeats = Σ assignment.seats` |
| 6,835 preceptor-shifts staffed by name (gap 206) | 4,248 of 4,420 | `:645-646` — `preceptorShifts = Σ ceil(preceptorsNeeded)` per assignment; `preceptorsAssigned = Σ preceptorIds.length` |
| 360,856 seats of supply | 360,856 | `:649` — `supplySeatsAllowed = Σ seatsAllowed` = every asset-shift in the window at an allowed site × `learnersPerShift` |
| 5,408 bookings from an earlier applied plan | 0 (fresh seed) | `SchedulerBoard.tsx:61` — `AssetBooking` rows whose note is `auto-plan` |

- **Demand** = `demandUnits` in `src/lib/schedulerplan.ts` (`schedulerModel`): every dated clinical
  session × section of every planned or running offering of the chosen college, at each term's
  *enrollment target* (`enrollmentByTerm`, derived from the goal ladder, not from the roster), over
  the window `schedulerWindow` = earliest term start → latest term start + 20 weeks (today
  2026-08-18 → 2028-04-27). A precepted section is one learner per seat, so "sections" and
  "learner-shifts" read the same number (7,246 = 7,246) — see §1.9 on wording.
- **Placed** is the plan built client-side under the current levers (`planFor`, `SchedulerBoard.tsx:63`).
  It is a *proposed scenario*, never a written record, unless "Apply" is pressed.
- **Preceptor-shifts staffed by name** counts named preceptor people at the chosen site on that
  shift; the default lever is "count seats only", so a placement can succeed without a named
  preceptor. The gap (206 then, 172 now) is exactly those. Under "require a free preceptor" the
  gap is zero by construction and placed drops (59%, see §2.4).
- **"Seats of supply"** is `seatsAllowed`: the theoretical asset-shift ceiling (every calendar day
  × every shift block an asset runs × learners per shift, at sites the agreement lever allows).
  It is not usable capacity: it ignores preceptor availability, holidays, the demand calendar and
  the fact that most asset-shifts have no student anywhere near them. The tile also shows
  536,334 "physical asset-shifts", the same idea at all sites.
- **"Bookings from an earlier applied plan"** counts `AssetBooking` rows (one per section × date ×
  asset), not learner-shifts, so it is not comparable to "placed".

Verdicts: 7,246 / placed / staffed — **label problem** (proposed scenario, section = learner-shift,
seats-only default unlabeled). 360,856 — **label problem** (theoretical ceiling). 5,408 —
**legitimate difference needing explanation** (different unit: booking rows vs learner-shifts).

**Why "placed" fell from 7,041 to 4,420 at the same demand and ceiling (close-out, 2026-09-18).**
The default levers never changed (`DEFAULT_POLICY` is byte-identical from a925d92 through today:
secured only, exact shift and date, skip holidays). The solver's placement rules changed once:
ead260c (2026-09-10) keeps a preceptor at their own employer and 770e08d keeps clinicals off class
days; neither shows up in today's unmet reasons. What changed is the supply the default levers
are allowed to use and the calendar:

| Lever experiment on today's seed | Placed | Unmet reasons |
|---|---|---|
| default (secured only, skip holidays) | 4,420 (61 %) | full 2,044 · holiday 602 · closed that day 162 · no agreement 18 |
| skip holidays off | 4,820 (67 %) | full 2,228 · closed 180 · no agreement 18 |
| any agreement | 6,482 (89 %) | holiday 602 · closed 162 |
| any agreement, holidays off | 7,066 (98 %) | closed 180 |
| any agreement, holidays off, flexible shift ± 2 days | 7,246 (100 %) | — |

So 2,062 of the 2,826 unplaced are **secured supply**: GEN places 3,082 of 5,586 and ORS 1,338 of
1,642 at secured sites. That supply moved under the reviewers' feet in two seed commits: 42e5329
(2026-09-09) took surgical technology off radiography's C-arms and onto operating-room suites
(ORS), of which secured hospitals have far fewer, and 5a69087 / 3a1bdb9 (2026-09-08/09) rebuilt the
site seed with agreement tiers per facility. The other 602 are the **real college holidays**
imported on 2026-09-17 (ca88739); before that only the U.S. defaults were observed. The reviewers'
97 % came from a seed where secured sites carried the demand and few holidays fell in the window,
not from different defaults or a different solver. The invariant that always held — under secured
only, placed can never exceed what secured sites can host per date — is now a test
(`test/metrics-audit.test.ts`).

### 1.2 Clinical site capacity: hostable by secured sites, booked onto assets

| Figure | Today | Computed in |
|---|---|---|
| 5,018 hostable by secured sites | 4,838 | `settingVerdicts` → `hostedSecured`, `src/lib/assetmap.ts`; rendered `AssetMapBoard.tsx:81` |
| 2,218 booked onto specific assets | 0 | `AssetMapBoard.tsx:56` — `Σ min(cell.demand, cell.booked)` over `AssetBooking` rows |

- Same demand source as the scheduler (`buildInstances` at `enrollmentByTerm`) — the page also
  reads 7,246 — but a **different window**: the clinical-sites page uses earliest term start →
  *latest term start* + 20 weeks computed from `termStartByIndex` of the capacity model
  (2026-08-17 → 2028-05-29), the scheduler board from `schedulerWindow` (2026-08-18 → 2028-04-27).
  Same formula, two implementations (`insights/clinical-sites/page.tsx:16-19` vs
  `schedulerplan.ts:23`), which happen to give different dates.
- **Hostable by secured sites** is a per date × shift block × setting cell:
  `min(demand, secured supply)` summed. It has no notion of a plan, preceptors, holidays, continuity
  or drive time. The scheduler's "placed" applies all of those, so it is always ≤ the cell ceiling
  and, under seats-only, usually below it (4,420 vs 4,838).
- **Booked** counts real `AssetBooking` rows against demand cells. It is the *applied plan*, so it
  is 0 until Apply is pressed and then equals what was applied, minus rows the plan could not
  place on an asset.

Verdicts: **legitimate difference needing explanation** (ceiling vs proposed scenario vs applied
plan, with two window calculations). The duplicated window formula is a **bug** to consolidate.

### 1.3 Site load: student-shifts, student-days at unsecured sites

| Figure | Today | Computed in |
|---|---|---|
| 7,722 student-shifts | 7,528 | `getSiteLoad`, `src/lib/queries.ts:2894` — one row per `StudentShift` record on a clinical session |
| 1,738 student-days at unsecured sites | (label not on page today) | `SiteLoadExplorer.tsx:78` — `Σ studentDays` of sites whose family agreement ≠ secured |

- Population: **`StudentShift` records** — the per-student roster written by
  `seedShiftAssignments`, `seedLearnerRecords` and the scheduler's Apply — for every cohort with
  status planned, active *or completed*, every status (scheduled, completed, absent), dated or
  undated. That is a third population, distinct from the scheduler's demand units (sections ×
  target seats) and the capacity page's cells.
- "Student-days" = rows with a date; "student-shifts" = all rows. Both are attendances, not
  distinct students.
- Site load is the only one of the three views that reads what students are *actually assigned*
  to; the other two read the template at target enrollment. So 7,528 > 7,246 is expected: the
  roster rows belong to the 38 students enrolled today (the 3 withdrawn have none), assigned to
  every clinical session the seed dated, while the scheduler's window and the target ladder (41
  falling to 36 by Term 5) cut demand differently, and completed cohorts' rows are in.

Verdict: **legitimate difference needing explanation** (roster rows vs template demand; includes
completed cohorts and undated rows).

### 1.4 Program page: 4,552 clinical rotations vs 376 hosted

Computed by `getProgramBottleneck` (`queries.ts:82`) → `buildAcademicPlan` (`src/lib/plan.ts`) on
`getProgramPlanData` (`queries.ts:846`):

- **4,552 "clinical rotations"** = the peak term's `clinicalSections` from `programDemand`
  (`src/lib/capacity.ts`), i.e. session sections (what the design page now calls *shifts*), summed
  across a **cohort series generated from the program's launch cadence and year targets**
  (`plan.ts`), not across the actual offerings.
- **376 "hosted"** = `Σ employer.wblSlots` after the alignment-profile adjustment
  (`effectivePlacementCapacity`, `queries.ts:880-883`). `wblSlots` is a legacy per-site slot count
  seeded years ago; it is not derived from assets, units or agreements.
- **"0 FTE"** faculty supply = `Σ fteCommitment` of program assignments with role instructor or
  coordinator (`queries.ts:866`) — a `ProgramAssignment` table the seed no longer fills, hence 0
  while 249 people exist.

This is the oldest planning module in the codebase (pre-asset-map). It computes demand and supply
on definitions nothing else uses. Verdict: **bug** — stale module; the banner should either read
from the capacity model / asset map or be retired. (57 "bottlenecks" today are 57 term-lines with
any gap.)

### 1.5 Master calendar: 24 conflicts in the displayed week

`detectConflicts` in `src/lib/space.ts:91` over the college's weekly `MeetingPattern` bookings:
two bookings in the same room on the same weekday whose times overlap and whose term-week
ranges overlap. It counts **weekly patterns**, not dated occurrences, and it ignores date moves.
The calendar filters the list to the displayed week by the patterns' week ranges. Today the week of
2026-08-17 shows no conflict banner on the current seed, so the 24 could not be reproduced; the
definition is clear and consistent with what the calendar shows.

Verdict (revised at close-out): **bug**. The detector ran on weekly patterns, so (a) a shift moved
off a day still counted there and one moved in did not, (b) a pattern counted in weeks where no
session of its kind meets, and (c) a three-way overlap counted as three conflicts. It now runs on
the displayed week's dated occurrences — each booking's session on its resolved weekday
(`resolveSessionDay`), after per-date moves — and the calendar counts overlap groups
(`detectDatedConflicts`, `conflictGroups` in `src/lib/space.ts`), listing the pairs beneath.

### 1.6 Daily coverage: 101 "students" on Aug 17, 2026 (41 + 41 + 19)

`studentsOnDay`, `src/components/CoverageCalendar.tsx:484` — sums section seats per cohort per
session on the day: RAD-110 class (41) + RAD-110 lab (41) + SUR 111 class (19) = 101. The same 41
radiography students attend both the class and the lab. Distinct students that day = 41 + 19 = 60.

Verdict: **label problem** (attendances shown as students). The fix is a distinct-student count
per day (by cohort, since seats are dealt from the cohort roster) with attendances as the
secondary figure.

### 1.7 Radiography: 73.8 preceptor FTE

`sessionService`, `src/lib/service.ts:78-88`: per session, `sections × preceptorsNeeded ×
lengthHours` = preceptor contact hours; `/ 640` (40 h × 16-week semester) = FTE. `ProgramDesigner`
sums this across **every session of every term of the whole program** (`calc.precFte`). 41
students × 1,152 clinical hours / 640 = 73.8 — a cumulative "semester-FTE" total over five terms,
not a concurrent headcount. The staffing-need page computes the concurrent figure week by week
(`weeklyNeedByKind`, peak ≈ 22 FTE in Spring 2027 for Radiography alone).

Verdict: **label problem**. Show "cumulative term-FTE across the program" and "peak concurrent"
side by side; keep faculty (college-paid) and preceptors (partner-provided) visually apart.

### 1.8 6,691 "sections" (program) and 96 "sections needed" (course)

Same quantity: `sessionService.sections = ceil(enrollment / maxStudents)` summed over sessions —
the number of times each session must be run at the enrollment. On 2026-09-18 the design pages
were relabeled "shifts" (`ProgramDesigner`, `OfferingDesign`); `CourseServicePanel.tsx:61` and
`CourseDemand.tsx:38` still say "Sections needed", and the scheduler statement says "clinical
sections" for demand units.

Verdict: **label problem**, partly fixed. Glossary needed (Phase 2): course section · session ·
session occurrence / shift · learner-shift · booking.

### 1.9 1,152 clinical hours per student vs 1,098 cumulative; RAD-171 144 vs 90

Two sources in the **same Sandhills workbook**:

- **1,152** = Σ clinical session `lengthHours` in the session table (RAD-151 96, RAD-161 240,
  RAD-171 **144** = 16 sessions × 9 h, RAD-251 336, RAD-261 336). Read by `ProgramDesigner` and
  `ClinicalAnalytics`.
- **1,098** = Σ `CourseClinicalRequirement.hoursPerStudent`, seeded from the workbook's
  "RAD PROGRAM COURSE ALLOCATION" table (`prisma/templates/rad-asset-map.json` → `courseAllocation`;
  RAD-171 = 35 GEN + 15 ED + 15 PORT + 15 OR + 5 FLUORO + 5 CT = **90**). Read by the requirement
  roll-up (`getProgramRequirementCoverage`, `queries.ts:434`) and the hours-by-setting grid.

The difference is entirely RAD-171: 54 hours the allocation table does not assign to any setting.
Verdict: **legitimate difference needing explanation** in source data — the partner's allocation
table is 54 h short of its own session table. Unmapped hours must be shown, not hidden. (The
roll-up and the grid were removed from Design & sequence on 2026-09-18 at the owner's request; the
figures still drive Clinical sites & requirements.)

### 1.10 Goal & pipeline, 2028: cohort shown (goal 29, 41 students, 35 enrolled) yet "0 allocated, 29 uncovered"

`GoalPlanner.tsx:276` — `allocGoal(a) = Σ slot.goal ?? 0`. A **locked** slot from an older plan
carries `goal: null` and shows its numbers through `slotTargets` (`:280-286`), which falls back to
the cohort's saved pipeline (goal 29). `allocGoal` does not use that fallback, so the total counts
the slot as 0 while the card beside it says 29.

Verdict: **bug** (one-line fix: `allocGoal` should sum `slotTargets(o).goal`). Also: the page
opens on 2027 (`selectedYear = years[1]`) while Radiography's only offering ends in 2028, so the
first thing a reader sees is "29 uncovered" for a year that has no offering by design — a
**label problem** to add to Phase 6.

### 1.11 Term-five enrollment target 36 vs 35 currently enrolled

- **36** = `enrollmentByTerm[5]` from `deriveCohortTargets` (`src/lib/pipeline.ts:102-117`):
  linear attrition from the Term 1 target (41) to the completing target (36 = 29 ÷ productivity
  ÷ placement ÷ licensure), per term.
- **35** = the reviewers' seed; today the roster holds 41, of whom 38 are enrolled and 3 withdrawn.
  Site load (§1.3) and the offering page agree on 38: the shift rows belong to exactly those 38
  students. The "enrolled now" figure reads that same count (`ledger.students` not withdrawn).

Target vs actual, both correct. Verdict: **label problem** — show "target 41 · enrolled now 38 —
at risk" on the current term (Phase 6.4).

## 2. The four questions

### 2.1 Numbers rendered without the formatter

`src/lib/format.ts` (`dec`, `fmt.num/pct/fte`) is the formatter; it caps *every* figure at two
decimals and drops trailing zeros. A crawl of every page on 2026-09-18 found no figure with three
or more decimals (the only hit is the CFR citation "483.152"). The reviewers' offenders
(82.2140822, 108.5365854 %, 30.1307692, 5.8333333, 2.2222222 …) were fixed by the decimals pass of
2026-09-17 (commit c6ccf84).

What still bypasses the module (candidates for Phase 1):

| Pattern | Files |
|---|---|
| `.toLocaleString("en-US")` / `.toLocaleString()` on numbers | SiteLoadExplorer (7), ScheduleBoard (5), LearnerAnalytics, FamilySitesTable, FacilityDirectory, AutoAssignButton, employers/[id]/page |
| `.toFixed()` | OfferingStaffing:20 |
| `{Math.round(x)}` / `Math.round(x * 100)%` inline | employers/[id]/page (4), SiteLoadExplorer, RequirementLog, PeopleDirectory (3 each), SchedulerBoard, PipelineAnalytics, GoalPlanner, FamilySitesTable (2 each) |
| `{n * 100}%` inline percentages | SchedulerBoard (4), ScheduleBoard, FunnelChart (3 each), UtilizationExplorer, SiteLoadExplorer, RequirementLog (2 each) |

Rule gaps against the Phase 1 spec: percentages render with up to 2 decimals (104.88% of goal);
average age with 2 (29.32); FTE with up to 2 (fine); pipeline stage targets are rounded at seed
time but the goal ladder shows the unrounded chain (r1 = 1 decimal) inline rather than on hover;
"required" pipeline counts round to nearest, not up.

### 2.2 Password gate

Server-side, in `src/middleware.ts`: every path except `/login`, `/api/login`, `/api/logout`,
`_next/static`, `_next/image` and static image/text files is redirected to `/login` unless the
`rosie_gate` cookie equals SHA-256(`password|rosie-gate-v1`) (`src/lib/gate.ts`). The cookie lasts
**30 days**, `httpOnly`, `SameSite=None; Secure; Partitioned` over https. The password is
`SITE_PASSWORD` or the default `Foundational`.

Two ways a reviewer loads the site without a prompt:

1. A cookie from an earlier visit within 30 days (same browser profile).
2. The static demo build: with `DEMO=1` the middleware lets everything through and the gate is
   `DemoGate.tsx`, a **client-side** check that can be bypassed by disabling JavaScript or reading
   the served HTML, and that a crawler is meant to pass.

Verdict: on Vercel the gate works as designed (server-enforced, digest cookie); the reported
no-prompt is **could not reproduce** here and most likely case 1. The DEMO build's gate is
cosmetic and should be documented as such (it is a static snapshot by design).

### 2.3 Does daily coverage read the same date-override data as the calendar?

Two kinds of move exist:

- **Per-occurrence moves** (`ShiftMove`: one session × section on one date → another date, time,
  site, staff). Written by daily coverage (`moveShiftOccurrence`, drag a chip or edit the day view)
  and by the scheduler's Apply. Read by daily coverage (`CoverageCalendar.tsx:115-145`, keyed
  `cohort|session|section|originDate`) **and** by the master calendar
  (`weekClinicalOccurrences`, `queries.ts:1545`). Consistent.
- **Weekly-pattern moves** (`moveMeeting`, `MasterCalendar.tsx:170-179`): the master calendar's
  "click a block to move it" changes the `MeetingPattern`'s weekday / time / room for every week.
  Daily coverage derives each occurrence's date from **the session's own weekday first**
  (`CoverageCalendar.tsx:139` — `r.session.dayOfWeek ?? m?.dayOfWeek`), so when the template
  session says Tuesday and the calendar moved the pattern to Thursday, coverage keeps Tuesday.
  The capacity model applies the same rule (`queries.ts:2248`).

Verdict: **bug** (confirmed by code reading, matches the Tue → Thu report). Either a pattern move
must win over the template day, or the calendar must stop offering pattern moves for sessions with
a fixed template day. Phase 2 fix.

### 2.4 Does changing the preceptor rule recompute?

Yes. The plan is a `useMemo` on the policy (`SchedulerBoard.tsx:63`), recomputed **synchronously
in the browser** on every lever change. Verified on the live app: seats-only → 61 % placed,
4,420 learner-shifts, 4,248 of 4,420 preceptor-shifts staffed; require a free preceptor → 59 %,
4,278, 4,278 of 4,278. The change took about 4 s during which the page is frozen; the initial
page took 8.7 s server-side. On a slower machine or a larger window the same recompute is
what the reviewers saw as a timeout, and the totals do not change until it finishes, with no
"computing…" state.

Verdict: **could not reproduce** the "unchanged"; the freeze is a **performance** problem (Phase 8)
and the missing pending state a **label problem** (Phase 5.3).

## 3. Concepts computed in more than one place

| Concept | Implementations |
|---|---|
| Analysis window (earliest term start → latest + 20 weeks) | `schedulerplan.ts:schedulerWindow`; `insights/clinical-sites/page.tsx:16-19` |
| Dated clinical demand | `buildInstances` (capacity model, coverage, asset map) and `demandUnits` (scheduler) share `buildInstances`; `plan.ts` (program page banner) re-derives from `programDemand` on a generated cohort series |
| Clinical supply | `assetSupply` (asset map cells); `recommendPlan` `supplyBySetting` (scheduler); `wblSlots` (program banner); `ClinicalSupplyBoard` unit-category grid |
| Students on a day | `studentsOnDay` (coverage, seats summed); site load `students` (distinct roster students); calendar roster (`weekClinicalOccurrences`, named students) |
| Sections / shifts | `sessionService.sections` (design, course, insights facts); scheduler `demandShifts` (dated units) |
| Clinical hours per student | session table (`ProgramDesigner`, `ClinicalAnalytics`) vs `CourseClinicalRequirement` (requirements roll-up, by-setting grid) |
| Withdrawal rate | `LearnerAnalytics` ("of decided": withdrawn ÷ (completed + withdrawn) = 100 %); offering page (withdrawn ÷ roster) |

## 4. Summary table

| Figure | Verdict |
|---|---|
| 7,246 learner-shifts demanded | label problem (proposed scenario; section = learner-shift) |
| 7,041 placed | label problem (seats-only default unlabeled) |
| 6,835 staffed by name, gap 206 | label problem |
| 5,018 hostable by secured sites | legitimate difference needing explanation (ceiling vs plan; duplicate window calc is a bug) |
| 2,218 booked onto assets | legitimate difference needing explanation (applied plan) |
| 7,722 student-shifts; 1,738 unsecured student-days | legitimate difference needing explanation (roster rows, all cohorts) |
| 5,408 bookings from an earlier plan | legitimate difference needing explanation (booking rows ≠ learner-shifts) |
| 4,552 clinical rotations vs 376 hosted | bug (stale planning module: generated cohort series vs legacy `wblSlots`; faculty supply reads an empty table) |
| 360,856 seats of supply | label problem (theoretical asset-shift ceiling) |
| 24 conflicts | could not reproduce (definition documented; pairwise count) |
| 101 students on Aug 17 | label problem (attendances; distinct = 60) |
| 73.8 preceptor FTE | label problem (cumulative term-FTE, not concurrent) |
| 6,691 sections / 96 sections needed | label problem (partly fixed 2026-09-18; glossary) |
| 1,152 vs 1,098 hours; RAD-171 144 vs 90 | legitimate difference needing explanation (workbook's allocation table 54 h short; show unmapped) |
| 2028 goal: 0 allocated / 29 uncovered | bug (`allocGoal` ignores locked slots' saved goal) |
| Term-5 target 36 vs 35 enrolled | label problem (target vs actual) |
| Raw floats on screen | fixed 2026-09-17; ~35 inline formats still bypass the module |
| Password gate | works server-side; could not reproduce the no-prompt (30-day cookie or DEMO build) |
| Coverage vs calendar overrides | bug (weekly-pattern moves ignored when the template session has a fixed day) |
| Preceptor lever recompute | could not reproduce; recompute works but freezes the page ~4 s with no pending state |

## 5. Remaining readers of the legacy supply fields (listed, not fixed)

`Employer.wblSlots` — a per-site slot count typed by hand, not derived from assets or agreements:

| Reader | Use |
|---|---|
| `src/lib/queries.ts:881-884` (`getProgramPlanData`) | supply for the retired launch-cadence plan (`plan.ts`) — no page reads it now |
| `src/lib/queries.ts:1224` (`getEmployersLite`) and `:2284` (`capacityModelFor` → `clinicalSites`) | shipped to the capacity board's *sites* view |
| `src/components/CapacityBoard.tsx:72, 1094, 1113, 1194-1195` | the "what each setting needs to host" view sums `wblSlots` as site supply and shows a share of it |
| `src/components/CapacityWorkbench.tsx:77` | "WBL / clinical slots" stat |
| `src/components/EmployerDirectory.tsx:256`, `src/lib/actions.ts:1028, 1052` | the field's own form and save |
| `src/lib/clinicalsupply.ts:24` | type only |
| `src/lib/capacity.ts:74-154`, `src/lib/plan.ts:44-250` | a *demand-side* `wblSlots` (clinical sections) — a name collision, not the site field |
| `prisma/seed-roster.ts:107-115` | seeds the values |

`ProgramAssignment.fteCommitment` — a staff-to-program FTE the seed no longer fills:

| Reader | Use |
|---|---|
| `src/lib/queries.ts:867-868` (`getProgramPlanData`) | faculty and preceptor supply for the retired plan |
| `src/lib/actions.ts:1872` | the assignment form's save |

## 6a. Notes for the owner before Phase 1

- Two items in the brief cut against changes made at the owner's request on 2026-09-18: the home
  page is now the North Star goals page (Phase 7 wants an exception queue above it), and the CMS
  roll-up and hours-by-setting grid were removed from Design & sequence (Phase 4.6 wants the
  1,152 / 1,098 bridge shown somewhere — Clinical sites & requirements is the natural home).
- The brief's "one phase per branch/PR" conflicts with this session's standing instruction to
  develop only on `claude/beautiful-wozniak-s9lf4d`. Phase 0 is committed there; say where later
  phases should go.

## 6. Outcomes (2026-09-18, owner: "fix everything in Phase 0")

| Finding | What changed | Where |
|---|---|---|
| Goal page "0 allocated / 29 uncovered" | root cause on inspection: an offering created outside the goal page (the seed, or the program page) is never an allocation in the saved plan, so the year's total ignored it while the card beside it listed it. The year's allocations now include every real offering delivering that year as a locked slot carrying its own saved goal (29 → "allocated 29 · fully covered"); `allocGoal` reads slots the way their cards do; the page opens on the latest year an offering delivers, and a saved year with neither offerings nor data yields to it | `GoalPlanner.tsx` (`allocs`, `allocGoal`, default year) |
| Coverage ignored calendar pattern moves | one resolver decides a session's weekday for every reader: the session's day while a booking sits on it, else the booking the calendar moved to a day no session uses | `capacitymodel.ts` `resolveSessionDay`; used by the capacity model (`queries.ts`), hence coverage, staffing, scheduler and asset map |
| Program page "4,552 rotations vs 376 hosted" | the stale launch-cadence banner is gone; the page points at the capacity-model views (staffing need, scheduler, site capacity) | `programs/[id]/page.tsx` |
| Two window calculations | the site-capacity page now uses `schedulerWindow`, the scheduler's own | `insights/clinical-sites/page.tsx` |
| Scenario vs ceiling vs roster, unexplained | a scope strip on the scheduler, site capacity, site load, daily coverage and staffing pages: what it shows, whose enrollment, window, constraints enforced, computed-at, and why each sibling view differs | `ScopeStrip.tsx` |
| 360,856 "seats of supply" | tile reads "Theoretical ceiling — every asset-shift × learners per shift, not usable capacity" | `SchedulerBoard.tsx` |
| Seats-only default unlabeled | the lever option says "exploratory — a shift can be placed with nobody to precept it"; the statement and the Placed tile say "seats only"; the Preceptors tile counts shifts placed with nobody to precept | `SchedulerBoard.tsx` |
| "sections" for dated shifts | scheduler statement, tiles and apply notice say shifts (section × date); course pages say "Shifts", "Shifts needed"; bookings notice says asset bookings ≠ learner-shifts | `scheduler.ts`, `SchedulerBoard.tsx`, `CourseServicePanel.tsx`, `CourseDemand.tsx` |
| 101 "students" on Aug 17 | the coverage list counts distinct students (each cohort once) with student-attendances beside it — 60 and 101 | `capacitymodel.ts` `distinctStudents`, `CapacityBoard.tsx` |
| 73.8 preceptor FTE | Design & sequence shows "across the whole program (semester-FTE added together — a budget total)" and, beside it, "peak week, at once" from the busiest template week ÷ the work week, faculty and preceptors separately | `ProgramDesigner.tsx` |
| 1,152 vs 1,098 hours; RAD-171 144 vs 90 | Clinical sites & requirements opens with "Clinical hours, two ways": session table vs hours coded by setting, per course, naming the unassigned hours | `queries.ts` `getFamilyClinicalHoursBridge`, `FamilyClinicalHub.tsx` |
| Term-5 target 36 vs 35 enrolled | the current term's row reads "target 36 · enrolled now 35 — at risk" when enrollment is below target | `FunnelChart.tsx` |
| Withdrawal "100 % of decided" | withdrawn and completed read "of N entrants" (everyone who started); average age shows one decimal | `LearnerAnalytics.tsx` |
| Lever change with no pending state | the plan is built from deferred levers; a "recomputing under the new levers…" badge shows while the previous plan's numbers are still on screen | `SchedulerBoard.tsx` |
| ~35 inline formats bypassing the module | `fmt.num / atLeast / pct / fte / hours / age / mult` with the Phase 1 rules; `toLocaleString`, `toFixed` and `dec(x*100)%` replaced in GoalPlanner, OfferingTargetsEditor, SiteLoadExplorer, ScheduleBoard, FacilityDirectory, AutoAssignButton, LearnerAnalytics, OfferingStaffing, employers page. Whole-number `Math.round(x*100)%` helpers and CSS bar widths were left: they satisfy the rule | `format.ts` |
| Password gate | no change — works server-side; the DEMO build's client gate is documented in §2.2 | — |
| 24 conflicts | no change — definition documented in §1.5 | — |

Tests: `test/metrics-audit.test.ts` (weekday resolver, 60-distinct-students fixture, formatter rules).

### Close-out additions (2026-09-18)

| Item | Outcome |
|---|---|
| Placed 7,041 → 4,420 | explained in §1.1: secured supply (ORS split, site seed tiers) and the imported holidays; defaults and solver unchanged. Test: under secured-only, placed ≤ hostable by secured sites |
| 35 vs 38 | 38 is right today (41 on roster, 3 withdrawn); §1.3 and §1.11 corrected; the at-risk label reads the same count site load does |
| Conflicts | §1.5 reclassified as a bug and fixed: dated occurrences after moves, resolved weekdays, groups not pairs; tests |
| Goal allocation | `yearAllocations` in `src/lib/goalalloc.ts`; test: an offering the plan already references is never counted twice |
| Withdrawal rate | one function, `outcomeStats` in `src/lib/learners.ts`, used by the analytics tiles, the pivot rows and the offering page; test: 9 of 60 entrants = 15 %, prospects excluded, null when nobody started |
| Hours bridge | `programHoursBridge` in `src/lib/hoursbridge.ts`; test: RAD-171 54 h unassigned |
| Legacy readers | listed in §5, not fixed |

## 7. Phase 1 — number formatting (2026-09-18)

| Item | Outcome |
|---|---|
| Required-pipeline counts round up and read "at least 83" | `fmt.atLeastPhrase`: a fractional requirement reads "at least 83", a whole one reads "29". Used by the offering funnel, the goal page ladder and offering editor, the pipeline analytics board and the program cards |
| Unrounded value on hover only | `fmt.calcTitle` puts "calculated 82.214082 · shown as at least 83" in the element's `title`; the figure itself never shows more than the rule allows |
| Targets stored at full precision | lock-in, the pipeline save and the seeds stored `Math.round(target)`; they now store the calculation (the column is a float). Display rounds, storage does not |
| Remaining hand-made formats | every `Math.round(x * 100)%`, `Math.round(minutes) min`, `Math.round(hours)h`, `toLocaleString`, `Math.ceil(fte)` in a page or component now goes through `fmt.pct / minutes / hours / atLeast / num / dateTime`. CSS bar widths and input values are left as numbers (not screen text) |
| A check that fails on a raw float | `test/format-lint.test.ts` parses every `.tsx` under `src/components` and `src/app` and fails on `.toFixed(`, `.toLocaleString(`, a `Math.round/ceil/floor` or a `/`·`*` calculation interpolated into JSX text, or `{x}%`. Attributes (`title`, `style`, `value`) are exempt; arithmetic inside a formatter call is fine |
| The twelve known offenders | crawled every page after the change: no figure with three or more decimals renders anywhere (the one match, "42 CFR §483.152", is a citation) |

Tests: `test/format.test.ts` (phrase, hover title, signed percent, minutes, timestamp), `test/format-lint.test.ts` (the static check, with a fixture proving what it catches).

## 8. Phase 2 — units, labels, glossary (2026-09-18)

| Item | Outcome |
|---|---|
| Glossary | `src/lib/glossary.ts` is the source (24 terms in five groups); `docs/glossary.md` is generated from it (`npm run glossary`) and the site has it at `/glossary` (nav: Glossary). A test fails if the doc drifts from the source or a retired synonym reappears in a page or component |
| Students vs attendances | daily coverage shows distinct students with student-attendances beside it (Phase 0); the glossary defines both; test: Aug 17 fixture = 60 |
| "Sections" | one meaning each: **course section** (a group of students), **section booking** (its weekly slot), **shift** (a section on one date), **learner-shift** (a seat on a date), **asset booking**. Dated occurrences no longer read "sections": scheduler levers, tiles, bottlenecks and plan; coverage day view; staffing drill; clinical analytics; the semester and capacity workbench totals; the auto-assign notice. Weekly patterns read "section bookings" on the employer directory, the site page and the supply board |
| FTE time basis | cumulative semester-FTE vs peak concurrent, faculty apart from preceptors (Phase 0); the glossary defines the basis |
| "Placement" | always qualified: **clinical placement** (scheduler, coverage chips, master calendar, supply board), **employment placement** (the funnel's "retained & placed in a regional job"), **work-based learning placement** (student page, site page). The goal is "fully productive workers", not "placements" |
| One term each | **offering** (retired: instantiation, class) and **cohort** for its students; **program** (retired: delivery model, model) and **program family**. The goal planner, supply board, capacity board and home page were reworded; the goal planner's types are `OfferingSummary` and `ProgramOption` |
| Date overrides in coverage | honored through the shared weekday resolver (Phase 0) |
| Imported course content | seventeen workbook typos fixed in the template packs (Clnical, Sctions, onine ×32, follws ×48, Contnued, immobilaztion, interactins, administation, compentency, manangerial, oriwntation, paient, pratical, rdview, facilitie, Finl, "12:20m"); the seed no longer writes the placeholder "<title> — imported from <workbook>" as a course description (37 courses now have none; a course with genuinely extra workbook coding keeps that note) |

Tests: `test/glossary.test.ts` (term set, doc in sync, retired synonyms absent), `test/metrics-audit.test.ts` (60 distinct students on Aug 17).
