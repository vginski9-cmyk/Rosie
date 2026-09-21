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

Verdict at the time: on Vercel the gate works as designed (server-enforced, digest cookie); the
reported no-prompt is **could not reproduce** here and most likely case 1. The DEMO build's gate is
cosmetic and should be documented as such (it is a static snapshot by design).

**Superseded by Phase 13 (§19):** the 30-day cookie, the repository-default password usable in
production and the static demo's person-level pages were each a way the site opened without a
prompt; all three are gone.

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

## 9. Phase 3 — evidence status drives the verdict (2026-09-18)

Decisions taken on the owner's "let's go" (each reversible): the provenance columns are additive and nullable; the provisional banner fires when no college calendar is imported and softens to a "dates set by hand" note when term dates were chosen rather than taken from it; an asset created with no learners-per-shift figure hosts 0 and is a GAP, not one seat; an ESTIMATE provision ranks with inference.

| Item | Outcome |
|---|---|
| One ordered status | `src/lib/evidence.ts`: `inferred → confirmed → committed → scheduled → verified complete`, with `unknown` and `unavailable` off the ladder; `evidenceStatus()` climbs only while every lower rung holds (the weakest input wins); success styling only from `confirmed` up. Existing fields map: provision `source VERIFIED` → confirmed, `ESTIMATE` or asset-only → inferred, `status none` / declined → unavailable, no asset and no record → unknown; secured agreement + accreditor recognized (where required) + a capacity figure → committed; a booking → scheduled; a preceptor-verified log → verified complete |
| Headline from the weakest required input | `coverageHeadline()` renders "Potential coverage identified for 42/42. Confirmed: 0/42." Green only when confirmed = required; amber (potential) while any required item rests on inference; rose while any has no provider. Used by the clinical hub, the programs list, the clinical index, the requirements scorecard, a site's checklist. Item and category verdicts read "possible" when only inferred; the scorecard bar shows confirmed (green) apart from potential (amber). Every `requiredCovered` now has a `requiredConfirmed` beside it |
| Surgical Technology | the standard's rules are scored as requirement lines beside the items (`src/lib/requirementrules.ts`): General Surgery First Scrub, four specialties confirmed for First Scrub, 120 cases per student a year at secured sites (unknown until a confirmed annual volume is on record). "1 of 1 covered" is now "Potential coverage identified for 3/4. Confirmed: 0/4." A `service-line-confirmation` rule names Cardiothoracic, Neurosurgery and Procurement & transplant: a generic OR suite never infers them; they read "possible — needs service-line confirmation" until the site confirms |
| Bulk confirm | removed (button and action). Each provision line is the site's own answer; saving as "confirmed with site" records who (a "confirmed by" field) and when, and an optional review-by date; an estimate records neither |
| Unverified standards | `UnverifiedStandard` marker on every derived output: the coverage headline everywhere, the student header's "% of ARRT", the offering's completion summary, a site's checklist and fit column, the employer page's program cards, the requirements panel |
| Provisional calendar | `getCalendarProvenance()` per institution (or all): calendar imported, term dates from the calendar / chosen by hand / from the pattern. `ProvisionalDatesBanner` on the scheduler, coverage, site capacity, site load, staffing (in the scope strip), the map, utilization, supply, semester, calendar, program overview, offering and offering design pages. Today: Sandhills quiet (10 of 10 from the calendar); Carteret, Lenoir and Roanoke-Chowan show "Dates set by hand" |
| Provenance columns | additive, nullable: `ClinicalAsset` and `FamilySite` get `evidenceSource, evidenceOwner, verifiedAt, reviewBy`; `SiteRequirementProvision` gets `evidenceOwner, verifiedAt, reviewBy` (source existed); `ClinicalRequirementSet` gets `verifiedBy, verifiedAt, reviewBy`. Status is derived, not stored. Seeds populate `evidenceSource` as the truth ("seeded estimate from the asset map — not confirmed with the site", "Sandhills master asset & shift map (workbook)", "state licensure / SMFP facility record") and leave `verifiedAt` null everywhere. The site agreement form, the provision checklist and the requirement set form write them |
| Missing is not zero | supply vs demand names the active sites with no students/day on record and leaves them out of the sum (amber, not green, while any is unknown); room and facility seat totals name rooms with unknown capacity; a site with no cap reads "cap unknown", a staff count with no figure "unknown", an estimated cases/day "(estimate)"; setup steps complete only on confirmed evidence (every asset VERIFIED; a VERIFIED staff count or a named preceptor; every required experience confirmed and none unknown) |

Not done, by design: no UI to edit an asset's provenance beyond its dataSource (the columns exist and the seed fills the source); `Employer.wblSlots` readers stay as listed in §5.

Tests: `test/evidence.test.ts` (ladder and weakest-input rule, headline tones, confirmed vs inferred counts, service-line no-inference, rule lines, provisional criterion); `test/requirements.test.ts` still passes.

## 10. Phase 4 — reconciliation and scope (2026-09-18)

| Item | Outcome |
|---|---|
| Scope strip on every capacity, load, coverage, staffing, scheduler and utilization screen | added to room utilization and asset supply (the other five had it from Phase 0); each says what it shows, whose enrollment, the window, what is enforced, when it was computed, and carries the provisional-dates line |
| One shared calculation module | `src/lib/clinicaldemand.ts` is the one definition of dated clinical demand (sections, students capped at sections × seats, shift block, setting). The scheduler's `demandUnits` and site capacity's `assetDemand` both start from it; §3's other duplicates were consolidated in Phase 0 (window, resolver, distinct students, withdrawal rate, hours bridge, goal allocation) |
| "Why does this differ?" bridge | `getCapacityBridge()` puts the three views' totals for one scope side by side in the strip: scheduler 7,246 learner-shifts = site capacity 7,246 (one definition); site load 7,480 student-shifts, a different population (the roster, completed cohorts included, withdrawn students' future shifts left out) |
| Withdrawn students out of future demand | `withdrawnRule()` in `src/lib/siteload.ts`: a withdrawn student's past shifts stay, their future and undated shifts leave site load and are counted on the strip; `Student.keepAssignments` (additive, default false) keeps them on the books when set. Enrollment-target demand never included withdrawn students; auto-assign already skips them |
| 360,856 "seats of supply" | relabeled theoretical ceiling in Phase 0; the supply page's strip says the same |
| 1,152 vs 1,098 hours; RAD-171 144 vs 90 | the hours bridge from Phase 0 names the unmapped hours on the clinical hub |

Tests: `test/reconcile.test.ts` — identical rows and window give identical learner-shifts and shifts in the scheduler and site capacity (101 on the Aug 17 week fixture; capped at sections × seats; a lab is never clinical demand); withdrawn rule keeps past, drops future and undated, counts what it dropped, honors the keep flag.

## 11. Phase 5 — scheduler readiness and validation (2026-09-18)

Decisions taken on the owner's "move on to the rest" (each reversible): `FamilySite.agreementEnds` and a `ChangeSet` table are the only schema additions (additive, nullable / new); a site's cap for readiness is `studentsAtOnce`, falling back to the accreditor's `approvedCapacity`, and no cap means "unknown", which never blocks; a confirmed experience is a VERIFIED provision (`provides` or `limited`) of a requirement item that names the asset setting — an inferred or estimated one reads "unverified" and keeps the shift off the ready count without blocking an apply.

| Item | Outcome |
|---|---|
| Headline is "ready", not "placed" | `Plan.summary.readiness` is a funnel in learner-shifts, each rung keeping only what passed every rung before it: location assigned → agreement eligible (secured on that date, honoring `agreementEnds`) → staffed by name (a named preceptor, and an instructor where the session needs one) → experience supported (the site confirmed the setting) → conflict-free (under the site's students-at-once, not on a holiday, students not in two places) → ready. The board leads with "Ready to run"; "Placed" is relabeled "Placed (seats only)" and marked exploratory whenever the Preceptors lever does not require one. The statement ends with the ready share. Sandhills today: 61% placed, 58.6% staffed by name, 0% ready — no site has confirmed an experience yet, which is the truth the earlier headline hid |
| Hard constraints vs preferences | the levers are two groups: hard constraints the plan never breaks (sites that count, preceptors, holidays, drive ring, drive cap from home, students per preceptor, weekly ceiling) and preferences it works toward (shift, day, continuity, balance, split, nearer home, rotate sites, variety, keep the same preceptor, new preceptors). A lever that changes nothing says so: "Changing Balance did not change the plan — the same N placed, M ready; the biggest bottleneck is …" |
| Specific unplaced reasons | every unmet shift carries a sentence (`Unmet.detail`): "1 student of Class of 2028 (RAD-151 §24) unplaced Tue 2026-08-18 Day: the 16 remaining eligible sites (…) are already full that shift (07:00–15:00)". The bottleneck cards show one, the unplaced table shows all |
| Blockers gate the apply | `Plan.blockers`: unsecured site, holiday, over a site's students-at-once, unprecepted, students in two places (blocking) and experience unconfirmed (a warning). The server refuses an apply while a blocking blocker stands unless the override box is ticked; the override and the blockers it waved through are written on the change record. The blockers tile and panel sit above the apply button; no green tile sits above a blocker |
| Preview → confirm → undo, recorded | scheduler apply, auto-assign and re-align each preview first (what would be created, changed, removed, and the blockers), write only on confirm, and record a `ChangeSet` (kind, label, offerings, counts, blockers, override, an undo snapshot). Undo restores the snapshot and marks the record undone. Re-align's preview is a dry run of the same engine (`alignOfferingToCalendar({ dryRun })`); auto-assign's preview runs the same plan the run would write plus the staffing and learner gaps. A "Recent changes" list on the scheduler shows the records with their undo |
| Verified in the browser and the database | scheduler: preview (4,420 bookings, blocked by 196 unprecepted and 7 over-capacity) → override → apply → undo left every table as the snapshot had it (0 plan rows, 7,772 hand preceptor rows, 603 of 603 clinical meeting patterns, 11,831 student shifts, 0 pinned). Auto-assign on the radiography offering (5,126 bookings, 8,996 staff rows, 268 student shifts, 156 pins) → undo returned 499 meetings, 7,171 staff rows, 858 section seats, 5,694 shifts, 0 pinned |
| Auto-assign and re-align gates | auto-assign's preview shows the same blockers and needs the same override; the re-align buttons are previews, with confirm disabled when nothing would move |

Not done, by design: `Student.keepAssignments` (Phase 4) still has no form field; withdrawal itself is a student-status change, not a bulk action, so it gets no change record.

Tests: `test/validation.test.ts` — the eight fixtures: 11 students against 10 seats leaves one unplaced with the specific sentence; supervision for 8 gives 8 staffed by name, not 10 (seats-only funnel drops two; require-preceptor places eight); an agreement that expires mid-term stops being eligible the day after it ends (unplaced under "secured", placed but flagged under "any"); a site over its students-at-once and a section in two places are conflicts, never ready; a shift moved Tuesday → Thursday shows Thursday in the assignment, roster, week grid and site row, and an unmoved holiday shift is a blocker; a withdrawal keeps today and the past, drops tomorrow onward and counts what it dropped; a site that has not confirmed the experience reads "unverified" and never ready, unknown likewise, confirmed ready; two programs sharing one room and one preceptor use each once and a booking on the books takes the seats first.

## 12. Phase 6 — outcome, goal and utilization metrics (2026-09-18)

| Item | Outcome |
|---|---|
| Withdrawal rate | unchanged from Phase 0: withdrawn to date ÷ everyone who started (12 of 470 = 2.6% on today's seed), never "of decided" |
| Completion rate only for cohorts old enough | `outcomeStats(learners, today)` counts completion only over entrants whose cohort has ended (`LearnerLite.cohortEnds`, the last term's end date); while no cohort has ended the rate is null and the tile says so ("no completion rate yet — no cohort has ended; 470 entrants still in cohorts running"). The demographic pivot applies the same rule per cell |
| Small cells | cells with fewer than 5 entrants show counts but no rates ("small cell (2 entrants) — rates suppressed"); `SMALL_CELL` in `src/lib/learners.ts` |
| Goal timing | `src/lib/goaltiming.ts` works backward from the end of the target year — ramp to productive (6 months), placement (3), licensure (3), then the program's weeks with 2-week breaks — to the date a cohort must start, and forward from today to the earliest year a cohort could deliver. The goal page shows the chain under the selected year ("Radiography (80 weeks incl. breaks): productive by Dec 2028 → placed by Jun 2028 → licensed by Mar 2028 → complete by Dec 2027 → cohort must start by Jun 2026 — already past; the earliest a cohort starting today delivers is 2029") and flags a year tile "not feasible — earliest delivery 2029" when its goal is above zero, no offering ends that year, and no program could deliver it from a start today (2026 and 2027 today). A new offering slot's suggested start is this required start. The lags are named on screen as default assumptions |
| "0 allocated / 29 uncovered" | fixed in Phase 0 (locked slots count their cohort's saved goal; the page opens on the latest year with an offering). Today: 2028 goal 29 · allocated 29 · fully covered |
| Target vs forecast | done in Phase 0: the current term reads "target at least 41 · enrolled now 38 — at risk" when enrollment is under target |
| "Reset to benchmark" | relabeled "Reset to default assumptions (workbook 2025)"; the Bench column is "Default (workbook 2025)" with the source on hover |
| Room utilization | coverage statement above the totals ("includes only the 2 programs loaded in Rosie (Radiography, Surgical Technology) — 2 offerings with weekly bookings; other institutional activity … is not modeled, so a low figure means 'unused by these programs', not 'empty'"). The headline denominator is now schedulable hours: each room's coded open hours on weekdays inside a coded semester, never a coded holiday or break (`schedulableDates()`); every coded hour of every calendar day is the secondary figure. Sandhills today: 1.5% of 152,460 schedulable room-hours over 363 days; 1.1% of 206,040 over all 632 days. A toggle switches the rows' denominator; the column header says which |

Tests: `test/phase6.test.ts` — running cohorts have a withdrawal rate and no completion rate; only ended cohorts are in the completion denominator; the pivot suppresses cells under five; the timing chain (Dec 31 → Jun 30 → Mar 30 → Dec 30 → 88 weeks earlier), earliest feasible year (2029 for a five-term program, 2027 for an 11-week course), the infeasible-year flag; schedulable dates (83 of the fall's 87 weekdays), the two denominators (830 vs 1,040 room-hours). `test/learners.test.ts` and `test/hoursbridge.test.ts` updated to the maturity and small-cell rules.

## 13. Phase 7 — the Home page is an exception queue (2026-09-18)

| Item | Outcome |
|---|---|
| Lead with the problems | `src/lib/exceptions.ts` builds the queue across every college: over-capacity site-days (a program's students at a site on a day above the site's students-at-once), student-shifts at sites without a secured agreement, sessions on observed holidays nobody has moved, upcoming clinical shifts with no preceptor named, calendar conflicts and unstaffed meetings (from the action queue), required experiences with no site, coverage resting on inference, and unverified or stale inputs (assets not confirmed, inputs past their review date, estimated provisions and staff counts). Blockers first, then warnings; notes folded. Every line says what is wrong, where, and what the reader will do on the linked screen ("fix: secure the agreement, or move the shifts to a secured site →") |
| Today's queue | 42 blockers · 2 warnings · 3 notes. Worst first: 2,397 student-shifts at 16 unsecured sites (Sandhills Radiography), 825 current or upcoming meetings with no instructor, 280 and 224 unprecepted shifts (Roanoke-Chowan Medical Assisting), 35 Radiography sessions on holidays, 29 scheduling conflicts, then Lenoir's cohorts with sessions on holidays. The page loads in about 1.7 s |
| No green above a blocker | `blockedFamilies()` names every family with a blocker; that family's evidence panel shows "⛔ N blockers — fix first ↑" before its coverage headline, and `CoverageHeadline` never renders the success tone while a blocker stands (it drops to potential and carries "N blockers first") |
| Setup and analytics below | the goals sections follow the queue; a "Setup & analytics" section at the bottom lists each college's setup link with its calendar provenance, and the analytics directory |

Tests: `test/exceptions.test.ts` — over-capacity counts the days and the worst day per site and treats no cap as unknown; unsecured placements roll up by family with the sites named and ignore the past; an unnamed preceptor is a gap only where the session needs one and only ahead of today; blockers sort first and the blocked families are named.

## 14. Phase 8 — performance, density, accessibility (2026-09-18)

Profiling first: the scheduler page's server queries take about 1.4 s in total (capacity model 0.23 s, scheduler data 0.05 s, bridge 0.65 s, site load 0.38 s); the remaining 4.5 s of its 5.9 s time-to-first-byte was React rendering the client board on the server, which built the whole plan (4.8 s of `recommendPlan`) before a byte left. Clinical site capacity was the same shape: the asset map's 365-day supply, demand and match computed in server rendering. The students filter was fast in every run (0.2 s); no timeout reproduced.

| Item | Outcome |
|---|---|
| Scheduler and clinical-capacity pages over 10 s | the plan and the asset map are built in the browser only: the page paints at once and says "Building the plan for 7,246 clinical shifts in your browser…" / "Matching every date, shift and setting against the assets…", then fills in. Time-to-first-byte: scheduler 5.9 s → 1.2 s (Carteret 0.2 s), site capacity 5.5 s → 1.2 s (page complete 3.8 s); the Sandhills plan still takes ~4.4 s of browser time, shown as a live status. The capacity model is memoized per request (`cache`), so a page and its scope bridge compute it once |
| Loading states | `src/app/loading.tsx` streams a skeleton with a polite live-region for every dynamic route, so navigation never sits on a blank page |
| Hydration errors 418/423/425 | not reproduced in a crawl of 18 pages (no console errors beyond a 404 on the login page). Two client components formatted dates with the browser's locale (`toLocaleDateString(undefined, …)`) — the server renders en-US, so a reader with another locale gets a text mismatch and exactly those React errors; both now use a fixed locale and zone |
| Clinical page: 500+ controls, dozens of saves | 508 inputs and 82 save buttons → 9 inputs and 0 bare saves at load. Each requirement item's editor exists only once "edit — <item>" is pressed (`Reveal`, progressive disclosure); one save model is stated once: every row saves on its own Save, writes only that row, and nothing else changes until it is pressed |
| Organization page: 652 controls, 378 icon-only buttons, 54 unlabeled selects | asset rows read as text; "Edit <setting> #n" opens one row (4 controls at load; one row adds 22). Every control in an open row has an accessible name naming the asset; day toggles carry `aria-pressed` |
| Scheduler shows ~17 controls before results | results first: the statement, the readiness funnel, the blockers and the apply flow lead; the levers fold under a one-line summary of what is set ("secured sites only · seats only (exploratory) · holidays left for moving · any distance · exact shift · exact date · all 2 offerings · 2026-08-17 → 2028-05-29") with a "change the levers" button |
| Unlabeled selects, icon-only and repeated buttons | every select on the utilization, supply, calendar and learner-analytics pages has a label or `aria-label`; the coverage and calendar arrow and close buttons have names; the people directory's repeated "edit" and "Save" buttons name the person; requirement and asset saves name the item. Crawl: 0 unlabeled selects and 0 unnamed icon buttons on the 18 pages |
| Contrast on qualifiers that govern a decision | the scope strip's labels, lever labels, tile sub-lines, "cap unknown", setup-step counts and the requirement panel's saving note moved from slate-300/400 (about 2.5:1 on white) to slate-500/600 or amber-700 (4.5:1 or better) |

Tests: unchanged suites pass (55 files, 396 tests); the crawl above (`perf8.mjs`) is the evidence for timings, control counts and console errors.

## 15. Phase 9 — use case 1: can this program expand? (2026-09-19)

The first of the seven use cases (`docs/use-cases.md`), built because it forces three foundations into existence: a scenario model, a constraint engine and an assumption registry (`docs/use-cases-gap.md`, F1, F2, F5). Nothing in this phase writes to the operating plan; the schema changes are two new tables (`Scenario`, `Assumption`) and nothing else.

| Item | Outcome |
|---|---|
| Where the question is asked | a sixth program tab, "Can it expand?" (`/programs/<id>/expand`). One form: workforce target and year, the design (additional annual cohort, larger cohort, accelerated, hybrid, expanded geography, shared regional cohort, improve retention), seats, first start, cohorts a year, the sites assumed secured, whether approval is needed |
| The answer | one sentence first — "Feasible as designed" or "Not feasible as designed: <what> binds first (<when>): <why>" — then six tiles (additional productive workers a year with the enrolled → completing → licensed → placed chain, the year the first workers enter, faculty FTE and people added, preceptors added, clinical learner-shifts a year by setting, cost per additional placed worker) and the confidence line: how many of the assumptions used are verified, the largest cohort feasible today, how many clinical assets are estimates |
| Proposed cohorts | dated with the program's own term structure (`alignOffering` + `buildInstances`, the same code the offerings use), one cohort per year (or more) from the first start through the target year's intake, holidays marked; every date, shift and setting they need is laid over every offering already planned |
| The constraint engine | faculty (FTE in the peak week against the roster), preceptors (preceptor-shifts a week at secured sites against people on record × shifts they take), clinical seats per date × shift × setting (physical ceiling) and, separately, agreements (the seats exist but are not secured), rooms (open room-hours a week), accreditor capacity (students on site at once, unknown when none is recorded), pipeline (seats the target needs at the current rates vs seats offered), time (lead times for recruiting, hiring, agreements, onboarding, equipment, renovation and approval, worked back from the first start; the earliest feasible start when they do not fit). Each constraint carries demand, supply, where it first bites, a fix, the shortfall and the evidence grade of its inputs. The binding one is the earliest-biting shortfall; "unknown" is a grade, never zero |
| What it adds | the pipeline ladder for the design's seats (`buildLadder`) at the effective rates; the year the first workers are productive from the last term's end plus the licensure, placement and ramp lags; learner-shifts a year at steady state |
| Costs | recurring: faculty (whole people where the roster falls short, otherwise adjunct hours within its slack), clinical coordination where agreements or preceptors bind, preceptor stipends where a stipend is set, student support per seat; one-time: a renovated space and an equipment set where rooms bind, annualized over the useful lives. Cost per additional placed worker = annual recurring + annualized one-time ÷ placed a year. Every cost figure is a default until a college sets its own, and the page says so |
| Timeline & owners | each lead time the constraints call for (recruiting, hiring, agreements, preceptor onboarding, equipment, renovation, approval) becomes a "begin" milestone counted back from the first start, followed by cohort 1 starting, completing and being fully productive; each carries an owner role and is marked late when its begin date has already passed |
| Assumption registry | `/orgs/<id>/assumptions` and the org page's "Planning assumptions →" link: 31 assumptions in five categories (pipeline rates, lags, lead times, costs, workload). Each resolves through program → job family → college → workspace → default, and shows its value, range, where it comes from, source, owner, status (default / estimate / verified) and review date (past-due flagged). A scenario can override any of them for itself only; the registry is untouched |
| Scenarios | saved per program with their design, overrides and last result; chips show feasible / not feasible / not evaluated; one can be marked recommended; "Compare N evaluated" puts them side by side (feasible, binds first, workers a year, first workers, faculty, preceptors, learner-shifts, cost per worker, confidence); an executive summary is generated for the proposal |
| Performance | the first evaluation took 23.7 s in the browser: `assetSupply` re-derived each date's weekday and re-parsed each asset's operating rule for every asset × day (about 850,000 Date allocations over a 3.7-year window), and the largest-feasible-cohort search re-ran it for every seat count. The date index and rule parse now happen once per window, and the supply and baseline match are memoized per window × assumed sites for the search. Evaluation: 22.0 s → 0.8 s cold, 0.1 s warm; the same fix speeds the asset-map totals and workbook export |

Worked check (Sandhills Radiography, 40 workers a year by 2029, one more 41-seat cohort each year from Aug 2027): not feasible as designed — clinical seats for the general setting bind first on 17 Aug 2027; the worst date is 23 Aug 2028 with 78 learners against 23 secured and 46 physical seats; the largest cohort feasible today is 12 seats. Faculty (9.4 vs 17.9 FTE), preceptors (204 vs 304 shifts), rooms (58 vs 2,280 hours) and the pipeline are covered; accreditor capacity and equipment are unknown. Assuming one more site secured raises the secured ceiling by one seat and does not change the verdict — the page says so rather than hiding it.

Tests: `test/expansion.test.ts` (9) — registry precedence and confidence; cohorts dated and repeated per year; nothing binding → outputs and costs; faculty binding with the week and hire count; agreements vs clinical seats with assumed-secured sites; baseline demand counted; time infeasible → earliest start; pipeline worked backward; the largest feasible cohort and the retention design. Full suite 56 files, 405 tests.

## 16. Phase 10 — the expansion page shows its work (2026-09-19)

The Phase 9 page asserted a verdict without its inputs beside it: a reader could not tell what a design actually changed (does "hybrid" put clinical online? do contact hours change?), which offerings were running at the same time, who made up the "78 learners" on the binding date, or what most of the terms meant. Every one of those is a trust failure, so the fix is a rule for the page, not a patch: nothing is asserted without its inputs beside it.

| Item | Outcome |
|---|---|
| What a design changes is silent | `designRules()` lists twelve aspects for every design — seats, cohorts, term length, class sessions, lab sessions, clinical sessions, clinical sites, faculty contact hours, rooms, pipeline rates, approvals, operating plan — each marked changed or unchanged, shown under the form before evaluating and saved with the result. Clinical sessions read "never delivered online in any design"; labs the same; an evening or weekend design says its clinical shifts are tested only against assets that run that shift |
| Hybrid quietly cut faculty hours | a hybrid design used to shorten class sessions, which cut room hours and faculty contact hours alike. Now the sessions keep their hours; the online share removes room hours only, and faculty hours are credited by a new registry assumption, "faculty contact-hour credit for an online class hour" (default 100%, range 50–100%), so the college's own policy can be set and the rule names it |
| What else is running | `result.concurrent`: every offering at the college whose sessions overlap the proposed cohorts, with its dates, the overlap, students, peak faculty FTE in the overlap and its student clinical shifts by setting; the same-program ones first and flagged. `weeklyPeaks`: the four busiest weeks for faculty, preceptors and rooms, each as "already planned + added = total of supply" with a chip per cohort on it |
| Who is on the binding date | every constraint carries `how` (one sentence of arithmetic), a demand breakdown by cohort and a supply breakdown by source: instructors with their policy hours; sites with their preceptors; rooms with their open hours; at the binding clinical cell, each site's seats that day and shift with its agreement status. The Sandhills Radiography check now reads: 78 needed vs 23 available on Aug 23, 2028 Day = proposed cohort 2 (41) + proposed cohort 1 (37) — the scenario's own two cohorts overlapping in general radiography, not the existing offerings |
| Jargon | setting codes carry their names ("General diagnostic radiography (GEN)"); "date-shifts" → "days × shifts"; "learner-shifts" → "student clinical shifts"; FTE, preceptor-shifts, room-hours, secured and physical seats defined on hover; every tile has a "how this is computed" hover |
| Prefilled figures read as recommendations | each form field says where its value came from (the program's default cohort size, the family's North Star goal for the year, the college's next fall start) or "your figure" once edited |
| What the answer was tested against | one line under the headline: the window, and the roster, preceptors, assets and rooms on record as of today; the full list on the In context tab, with a note that it is edited on the people, clinical and rooms pages, not here |
| Compare view trapped the reader | a "back to <scenario>" link; results saved before this phase show as "not evaluated" until re-run rather than rendering without their context |

Tests: `test/expansion.test.ts` adds the breakdown, concurrent, peak-week, how-computed and supply-summary checks to the baseline test, and a hybrid test (room hours fall, faculty hours hold at a 100% credit and fall at 50%, clinical unchanged, the rules say so). Suite: 56 files, 406 tests.

## 17. Phase 11 — the audit: every page, every number, every connection (2026-09-19)

Four read-only audits ran in parallel against the production build and `prisma/dev.db`: the computation libraries (reproduced with scripts), data integrity (128 relations, ~180 cross-table checks, every JSON column), cross-page consistency (the same quantity captured from every page that shows it and recomputed), and a crawl of every route with real ids (console, hydration, links, controls, actions). Everything below was reproduced before it was fixed; the fixes are regression-tested in `test/audit-fixes.test.ts` and the affected suites.

### Computation defects

| Defect | Outcome |
|---|---|
| Every term or course that does not start on a Monday dated every session on the wrong weekday (a Tuesday start put "Mon" sessions on Tuesday and "Fri" on Saturday; 1,044 of 2,846 dated sessions, 37%, and 34 clinical shifts on weekends) | week 1 is the calendar week that contains the first day, so every session keeps its weekday; a "Mon" session in a Tuesday-start week falls before the term and is undated and flagged (`beforeTerm`), like one past the end. The master calendar's week-of-term and the three itinerary queries use the same anchor, and course windows carry the template week they begin in |
| US default holidays were unioned with the college's imported calendar (Veterans Day, Columbus Day and winter-break flags on days the college is open; 63 phantom holiday sessions at Lenoir) | the imported calendar is the only authority once one exists; the US list stands in only for a college with no calendar coded |
| Three seat-to-section rules (scheduler filled sections to the maximum, 20-20-1; the calendarizer dealt evenly, 14-14-13; the roster round-robined), so a plan pinned students to sections the room bookings and roster disagreed with | one rule in `lib/sections.ts`: seats are dealt evenly and each demand unit carries its seat span; the scheduler, plan-apply, calendarizer and roster read it |
| Hybrid-style rules aside, the expansion engine credited the target year with another year's graduates when none graduated in it (Radiography 2029: "covered", −0 seats needed) | only offerings graduating in the target year count; −0 can no longer reach the screen (`fmt.atLeast`, the pipeline constraint) |
| Two thinning curves (real offerings one slice above completing; proposed cohorts sliding to completing), so an identical proposed cohort needed one fewer clinical seat than the real one | one `thinTerms` rule in `lib/pipeline.ts`, used by the workbook chain, the capacity model and the expansion engine |
| The per-request memo of the capacity model never hit (React `cache` keys object arguments by identity), so pages computed it two or three times | keyed on the primitive ids |
| The semester view ended every term at its template weeks, not its coded last day (21 of 53 terms more than a week off) | the coded end wins |
| Preceptor contact hours: blank policy = 0 in the capacity model, ignored in the service model, 1 in the explainer | blank means the whole shift, in all three |
| A shift moved by hand or by the plan onto a holiday was never flagged | checked against the calendar on its new date |
| Archived-facility filtering differed between totals and supply; site-load hours counted absent shifts at full length; local-time reads of UTC dates in three places; a Feb-29 start crashed the studio | one `isLive` rule; absent and excused shifts are 0 hours; UTC everywhere; leap days clamp |

### Data and connection defects

| Defect | Outcome |
|---|---|
| Two agreement statuses per site (the employer umbrella and each job family's own agreement), read differently by every page ("18 secured hosts" and "0 secured sites" for the same setting on one page); the Sandhills site seed also randomised the family tier | the family's agreement is the record and the employer status is the umbrella: assets carry `agreementByFamily`, `forFamily()` resolves it, and the seed no longer randomises. The expansion engine, the offering's clinical page and the site-capacity board resolve per job family; the employer level stands in only where a family has no row |
| Clinical units coded 0 students per shift while the same sites' assets carry 46 imaging seats, so "Clinical sites" showed no imaging capacity | a unit with no coded capacity reads it from the site's assets in the settings that serve its category, marked as derived |
| "Delete North Star goal" deleted the whole job family, cascading its sites, requirement sets and every student's competency log | it clears the goal only; the family and its records stay |
| Deleting a term, course or session erased logged clinical shifts; removing a family site left weekly bookings pointing at it | a delete is refused while logged shifts hang from it; removed sites are cleared from bookings |
| The capacity model re-derived Carteret's Term-1 seats from the productive goal (18) while every other page said 10 | term 1 is the enrollment the offering plans (its enrolled target or planned seats); the productive goal is a fallback only |
| A registry value could be stored under any key with no range check (my own browser test had written a salary into a rate) | saved values are checked against their unit and range; the row is removed |
| SUR 123's 16 "clinical" sessions were online with no weekday and no site; Carteret's two rotation types mapped to no setting; a hospital created from the surgical tracker had no external id, so its assets duplicated another hospital's ids; the parser left "( )" in nine holiday labels; a template typo | fixed in the template, seed and parser |
| Pipeline actuals were three sets of numbers (offering page from stage actuals; goal page from student statuses skipping the withdrawn at every stage; students page dropping the withdrawn) | the goal page reads the same stage actuals as the offering page; a withdrawn student counts as having reached "enrolled" |
| Attendance counters on the student row were written once by the seed and never maintained (58 students with 9 attended and 0 logged shifts) | attendance is read from the shift ledger on every page |
| "Section 37" on a student was a seat number; the org page's "Preceptors" counted every person of any role; the funnel had no "withdrawn" stage | labelled "Seat"; active preceptors only; withdrawn reads as withdrawn |
| Room utilization on the org page summed every term's bookings into one week (6.4% vs 1.5%) | the busiest week |
| Three FTE denominators (design page ÷ 40-hour week, capacity model and expansion ÷ full-time contact load) | one denominator, named on the design page |
| Home's holiday count is upcoming sessions, the offering's is all; the semester bars synthesised dates for undated sessions; the expansion default start was a Sunday; a scenario evaluated by an older engine read "not evaluated"; explicit offerings with no entry-term code vanished from the launch plan | labelled "upcoming"; dated sessions only; the coded fall start or the Monday on or after the anchor; "evaluated with an older engine — re-evaluate"; the entry term is read from the start date |
| Three of four colleges have no clinical sites, assets or preceptors on record at all, yet 4,047 clinical shifts | the exception queue leads with it as a blocker: missing data, not zero demand |

### Page-level defects from the crawl (845 URLs, 1,871 links, 186 controls, 162 actions reviewed)

| Defect | Outcome |
|---|---|
| A blank numeric field saved as 0 through the shared form helper (workload assumptions, policies, sessions, assets, units, geography bands, shift assignments) | a blank field keeps the default; two more parsers stop writing NaN |
| Every registry save re-stamped "verified today" and wrote the resolved default range as the college's own figures | the verification date is kept unless the status changes to verified; the range fields start blank |
| The site-capacity page's agreement select changed the employer umbrella only, so every program page still read the old family status | it sets the one status per site: the umbrella and every family's row move together |
| `/calendar?week=abc`, `/supply` with a bad custom window and `/api/asset-map` with a bad year or institution crashed | validated; the API answers 400/404 |
| The goal planner showed "starts — · ends ~—" for a dated, running offering | the live cohort date |
| 22 exported server actions had no caller (each a public POST endpoint); 13 revalidated routes that do not exist | removed; paths point at the pages that render the data |
| A plain GET to the logout route ended the session | POST signs out; a bare GET only goes to the login page |
| Copy: "602 because lands on an observed holiday", "Day7a, 8a", "7,171 staff assignments" as a headline | fixed and labelled |
| 4,200 unlabeled selects and inputs on the site-provision pages; unlabeled date, range and search inputs on six explorers; the requirement-log select | accessible names on all of them |

Verification: typecheck clean; 57 test files, 416 tests; production build; a browser run over Home, the program, goal, students, offering, org, calendar, supply, scheduler, site-capacity, expansion, registry, semester and student pages with no console or page errors, and the API returning 400/404 on bad input. The seed changes were validated by seeding a throwaway copy of the database; the live dev database received the same corrections as targeted updates (9 labels, 16 sessions, 304 shifts, 2 rotations, 2 employer ids) so record ids stayed stable.

### Left as recorded (data-entry, not code)
Lenoir's real meeting days never reached its sessions (the seed sets Mon/Wed templates and Mon/Sat bookings); 217 sessions land on coded holidays and are listed as exceptions; 34 completed cohorts carry no students; duplicate student names across stages are seed artefacts; every employer is geocoded to its town centroid. These are shown as what they are on the pages that read them.

## 18. Phase 12 — clinical partners for the three colleges that had none (2026-09-19)

Lenoir, Carteret and Roanoke-Chowan carried 4,047 clinical shifts with no sites, assets or preceptors on record. `prisma/seed-partner-sites.ts` adds 29 partners looked up from public listings in September 2026 (state SNF list, CMS, facility and health-system sites), shaped by how each program actually places students rather than by the imaging model:

| Program | Placement model | Supply modelled as | Sites |
|---|---|---|---|
| Nurse Aide I (Lenoir; Carteret) | instructor-led group on a nursing hall: the college's RN supervises up to 10 students (NCBON / NATCEP ratio); the site provides the hall, not a preceptor | `LTC` halls at skilled nursing facilities (1–3 halls by bed count, 10 learners each, Day + Evening, 7 days) and adult care homes (1 hall, 6 learners, weekday Day); a `BEDS` medical-surgical unit at the hospital for the acute-care day (5 learners, hospital cap); preceptorsPerShift 0; a staff-development RN liaison per site with an agreement in motion | Lenoir 10 (UNC Health Lenoir 199 beds; Harmony Hall 175; Signature Healthcare of Kinston 106; NC State Veterans Home; Kinston Rehabilitation; Greendale Forest, Snow Hill 115; Brook Stone, Pollocksville 80; Spring Arbor, The Village of Kinston, Snow Hill Assisted Living). Carteret 7 (Carteret Health Care 135 beds; Harborview 122; Crystal Bluffs 92; Croatan Ridge, Newport 64; Embassy at Morehead City 92; Carteret Landing 110; Carteret House) |
| Medical Assisting (Roanoke-Chowan) | precepted 1:1 externship (160 h, CAAHEP) in an ambulatory office | `AMB` externship slots (exam rooms + front office), 1 learner and 1 CMA preceptor each, weekday Day; a CMA preceptor and practice manager per site | 12 across Hertford, Bertie, Gates and Northampton (Roanoke Chowan Community Health Center at Ahoskie, Colerain and Murfreesboro; ECU Health Roanoke-Chowan Hospital outpatient clinic; ECU Health Family Medicine — Windsor; ECU Health Bertie Hospital; Bertie County Rural Health; Gates County Medical Center; Rural Health Group at Jackson and Rich Square; the Northampton and Hertford health departments) |

Every hall count, group size, slot count and agreement tier is a planning estimate: asset rows carry dataSource ESTIMATE, family-site rows say the tier is a placeholder to confirm with the site, and an address that could not be confirmed is marked as an estimate on the employer record. One unit row per site feeds the supply grid in the workbook's terms. The nine service-area towns missing from the offline gazetteer were added so drive-time rings code correctly (Kinston core; Pollocksville and Windsor ring 1).

What the tool says now that it could not before: Carteret's offerings place on the first run except 6 holiday shifts; Lenoir's many concurrent cohorts collide on the same halls (160 learner-shifts short at the secured sites) and 670 land on a day the cohort has class, which is a template defect (the Mon/Wed cohorts' clinical is coded on the class day) recorded for data entry; Roanoke-Chowan's 1:1 externship needs more secured slots than its two secured sites carry (250 of 286 unplaced until the asked and prospect sites sign). The exception queue no longer shows the "no clinical supply" blocker for any college.

Tests: `test/partnersites.test.ts` (unique ids and names, gazetteer coverage, the right kinds of site per program, county coverage, sources and estimate flags). Suite: 58 files, 420 tests.

## 19. Phase 13 — the product boundary, and the door (2026-09-19)

The owner's redesign: Rosie is a strategic planning product for executives. It keeps the deep model of operational reality (calendars, sequences, faculty qualification supply, ratios, preceptors, agreement dates, assets, experience types, travel, holidays, rooms and equipment, retention, lead times, evidence, uncertainty) and stops presenting operational administration as the product. Everything that is not the executive question is classified as **(1) an imported input**, **(2) a diagnostic drill-down**, or **(3) a separately scoped operational module**.

### Access control — the reported defect, and its causes

"The site still opened directly in a fresh browser session without requiring the supplied password." Three real causes, each fixed in `src/lib/gate.ts`, `src/middleware.ts` and `src/app/api/login/route.ts`:

| Cause | Before | Now |
|---|---|---|
| Cookie lifetime | 30-day persistent cookie: any browser profile that had ever signed in opened the site for a month | A **session cookie** (dropped when the browser closes) carrying a signed token that also **expires after 12 hours** (`GATE_TTL_SECONDS`) |
| Default password in production | With no `SITE_PASSWORD` set, the repository default `Foundational` opened a production deployment; the cookie was a bare SHA-256 that could be minted from the source | In production there is **no default**: with nothing configured the site **fails closed** and the login page says "not configured". The token is an HMAC keyed by `SITE_SECRET` (else the password) and cannot be forged from the repository once a real password is set |
| The static demo | The GitHub Pages snapshot's gate runs in the browser and protects nothing; it crawled every page, including student and people records | The crawler excludes `/students`, `/people`, `/calendar`, per-student pages and the pivot (`scripts/crawl-demo.mjs` EXCLUDED); DEPLOY.md says the demo is not access-controlled and holds no person-level record |

Also: constant-time password comparison; a bad or expired cookie is cleared on redirect; gated responses carry `Cache-Control: private, no-store` and `X-Robots-Tag: noindex`; sign-out is a POST (a GET needs `?confirm=1`). Tests: `test/gate.test.ts` (round trip, wrong password, expiry, tamper).

### The ten scope corrections

| # | Correction | Where |
|---|---|---|
| 1 | Students, People and Calendar out of the primary navigation | `MainNav.tsx`: Home · Programs · Scenarios · Capacity · Setup · Glossary. The records stay reachable as drill-downs from Setup → Operational records and from a program's Students tab |
| 2 | "Can it expand?" is a primary workflow, **Scenarios** | `/scenarios` (`src/app/scenarios/page.tsx`, `getScenarioHub`): every program, its target, baseline, shortfall and each saved scenario's answer, binding constraint, workers added, cost per placed worker, confidence. The program tab is renamed; the studio is unchanged beneath it |
| 3 | Insights replaced by a focused **Capacity** area | `/capacity` (`src/app/(insights)/capacity/page.tsx`): staffing, clinical, facilities & equipment, pipeline, evidence & uncertainty — each with headline figures and its drill-downs. The tab strip leads with Capacity; `/insights` redirects there |
| 4 | Home answers the six executive questions | `src/lib/executive.ts` + `src/app/goals/page.tsx`: targets at risk, expected shortfall (target − the baseline the engine measured), binding constraints rolled up by kind, highest-value interventions (feasible scenarios by cost per placed worker), evidence gaps (unverified and stale assumptions, provisional calendars, estimated site figures, engine risks), recent material changes (scenarios, assumptions, applied plans, program designs, 60 days). The exception queue moved to Setup → Exceptions; Home shows its count |
| 5 | Learner-shift calculations stay in the engine; executives see root constraints | Nothing about the engine changed. The Home and Scenarios pages show the binding constraint's kind, shortfall, unit and fix — never the rows beneath |
| 6 | The scheduler's "apply" is isolated | `SchedulerBoard` takes `canApply`; the strategic product renders the plan as a diagnostic with no preview / apply / undo / clear, and `applySchedulerLevers`, `undoChangeSet`, `clearSchedulerPlan` refuse on the server |
| 7 | Individual competency logging out of core scope | `RequirementLog` takes `readOnly`: entries read as imported evidence; log / verify / delete are hidden and refused |
| 8 | Offering records are read-mostly actuals | The offering page: no auto-assign; staffing, rotations and the shift ledger render inside `<ReadOnly>` (a disabled fieldset) with a note; dates can be typed only while the offering is still planned. Creating a planned offering and locking one in from the goal planner remain open — they are planning, not administration |
| 9 | Setup reduced to connections, mappings, assumptions, evidence review, exceptions | `src/app/orgs/[id]/page.tsx` rebuilt in that order: connection cards (calendar, program sheets, asset maps, student and staffing systems) → mappings (basics & geography, rooms & equipment, sites & assets, people & policies, programs) → the assumption registry's status → an evidence checklist (calendar provenance, requirement sets, site staff figures, asset confirmations, assumption verification) → this college's exceptions → operational records and diagnostics |
| 10 | The generic Explore pivot off the main experience | Moved to `/insights/explore`, linked only from Setup → diagnostics |

The boundary itself is one flag, `ROSIE_OPERATIONAL=1` (`src/lib/mode.ts`). Thirty-seven server actions that write the operating plan's placements and staffing, or a person-level record, call `requireOperational()` first, so a hidden form cannot be replayed. Planning decisions stay open in the strategic product: locking a goal-year cohort in or out from the goal planner, creating a planned offering, setting a planned offering's start and term dates, and deriving its term dates and calendar meetings from the college calendar (a running offering's dates are imported). A defect found on the live site after the phase shipped: lock-in failed silently because those two derivations were guarded, and the planner opened on the wrong year because a chosen year without an offering yielded to the year that had one. Both fixed; the planner now reports a refused action and a newly added program's first offering starts with the year's uncovered goal so it can be locked in at once. The student page shows coded fields only (no name edit, e-mail, phone, address, date of birth, GPA) unless the module is on.

### What "missing ≠ zero" means on the executive Home

A target with no evaluated scenario is **not assessed**; its baseline and shortfall show `?`, never 0, and it sorts after the at-risk targets and before the covered ones. The baseline is the engine's measurement of what the offerings already planned yield — it exists only once a scenario has been evaluated for that program, which is why the page says so rather than inventing one.

Tests: `test/executive.test.ts` (12: unassessed vs at-risk vs covered vs on-track, target-year fallback, recommended-first choice, binding roll-up, intervention ranking, evidence gaps, the guard) and `test/gate.test.ts` (4). Suite: 60 files, 436 tests.

### The holiday rule (2026-09-19)

Sessions that landed on an observed holiday were flagged and left for someone to move by hand, one at a time, on the offering's design page — 641 clinical shifts at Sandhills alone sat "unplaced — lands on an observed holiday" in the scheduler. Now one rule, set per college under Setup → Basics (`Institution.holidayRule`, additive, default `next-open-day`), moves them automatically at the single place sessions are dated (`buildInstances`, `lib/holidayrule.ts`), so class, lab and clinical all follow it and every reader agrees:

| Rule | What happens to a session on a holiday |
|---|---|
| next-open-day (default) | forward to the next open day in the same Mon–Sun week, then backward; a weekday session stays on weekdays |
| previous-open-day | backward first, then forward |
| flag-only | nothing moves; the collision is listed for someone to resolve |

A day the same course and kind already uses that week is never chosen (Mon/Wed class: the Mon holiday cannot land on Wed); a day the cohort has any other session on (a class day, for a clinical shift) is avoided while a free day exists and used only when the week has none; the coded college calendar is the only authority once it exists (the U.S. list stands in only with no calendar), and a whole-week break stays flagged because moving into another week is a re-sequence nobody asked for. The scheduler's demand, daily coverage, the master calendar's dated week, the calendar's per-cohort dates and the design page all apply the same rule; a hand-made per-occurrence move is filed under the pattern date and still wins. Each moved session carries where it came from (`holidayMoved`), shown as "↪ off Thanksgiving" on the design page and "holiday rule" on coverage; the exception queue lists what the rule moved as a note and keeps only the unresolved collisions as blockers.

Tests: `test/holidayrule.test.ts` (the three rules, siblings, weekends, the calendar as authority, class/lab/clinical through `buildInstances`, hand-made moves over the rule in scheduler demand).

### The capacity picture on the clinical scheduler (2026-09-19)

The first cut of "supply against demand" was a panel of eight numbers nobody could read. It is now one card (`src/components/SchedulerCapacity.tsx`) that answers the question in order: **You need N learner-shifts** (one learner on one shift); a verdict sentence (enough seats and preceptors · enough seats but not preceptors · short on seats); three rings that shrink from the outside in — found a seat, and a preceptor named, and passes every check — as shares of what is needed; and three bars against one black line at what is needed: seats on the days you need them at the sites your levers allow, the same seats a preceptor on the roster could cover (per site and shift, preceptors × students per preceptor — an estimate), and the seats if every site counted. Every figure recomputes with the levers, and the card names which levers move it (Sites that count, Drive ring, Day, Shift, Students per preceptor, the window and the offerings) and which only move *where* shifts go. Ring hues are the validated first three categorical slots (blue, orange, aqua; worst adjacent CVD ΔE 9.2, normal 27.6). New engine figures: `supplySeatsPhysicalOnDemandDays`, `supplySeatsStaffableOnDemandDays` (tests in `test/scheduler.test.ts`).

### Radiography's plan, and the pages (2026-09-19)

The owner's revised ask for Sandhills Radiography is in the seed (`prisma/seed.ts`, `prisma/seed-roster.ts`), so every deploy carries it: 15 productive workers a year for 2026 and 2027, 30 a year for 2028–2030; one class per goal year, each on the college's Fall first day — the Class of 2026 (completed; started Aug 19 2024), 2027 (in program; Aug 18 2025), 2028 (Aug 17 2026), 2029 (Aug 16 2027) and 2030 (Aug 21 2028) — the last three planned at a 90% completion rate (`rates` per offering in `seedOfferings`, which now also marks a class whose last day has passed as completed). At those rates 30 productive workers need 43 seats against a program maximum of 41; the planner flags it rather than hiding it. The "working backward from the goal" block and the "not feasible" chips came out of the goal planner; a locked-in allocation no longer sprouts an empty extra slot from the suggested count.

Every main page now opens with one header (`src/components/PageHeader.tsx`): a crumb, the title, one sentence on what the page answers, a facts line and the page's actions — in place of a paragraph each. The planner's instructions are one line.

### The scenario planner switched off; Home, Programs and the design page simplified (2026-09-19)

The owner's call: the scenario planner is hidden (`ROSIE_SCENARIOS=1` brings it back; the engine, the executive summary code and their tests stay). Scenarios is gone from the navigation and the program tabs, `/scenarios` sends to Programs, and a program's expand page is not found without the flag. Home is the colleges and their targets again — each college, its jobs with the goal for every year, the programs that deliver them — with none of the executive block. Programs is three levels, one at a time: the colleges → a college's job families → a family's programs with every offering (status, start, goal, students), and a program page's breadcrumb walks back through them. The design page leads with the terms and courses at the planned enrollment; the numbers table, clinical analytics, workload assumptions and the spreadsheet importer are closed until wanted. The offering page's pipeline and requirements panels open closed too.

### The second pass: offerings, setup, capacity, records (2026-09-19)

The same treatment for the pages under the main ones. A program's first tab is now **Offerings**: one table (offering, status, starts, terms dated, goal, enrolled) with the create form beneath it, in place of cards with staffing-row counts and a paragraph about the strategic product; the tab strip reads Offerings · Design & sequence · Clinical sites · Goal & pipeline · Students. An offering opens with one header — the class, its phase, one sentence on where it is (now in Term 4, week 57 of 89; last day) — four tiles (starts, last day, goal, students) and eight closed sections with a short line each: Talent pipeline, Term dates, Course sequence, Staffing, Completion requirements, Clinical rotations, Students, Calendar. The "read-mostly record" paragraph is gone, the term-dates table keeps its source as a badge with the calendar label on hover, the shorter-course windows fold behind a summary line, and the holiday notes are one sentence each. An offering's design page folds its spreadsheet importer away like the template's. Setup for a college keeps its five steps but each section's description is one line, the scenario link and count are gone, and the holiday hint is the rule's own sentence. Capacity reads Staffing · Clinical seats · Rooms & equipment · Pipeline · How well the inputs are known, with one clause per link. The student and organization records lose their section numbers and the sentence-long subtitles. Nothing was computed differently; the suite stays at 61 files, 452 tests.

### The break rule, and the master calendar (2026-09-19)

**Whole-week breaks.** The holiday rule moved a session off a single closed day inside an open week and left a whole closed week (spring break, winter break) flagged, session by session, for someone to move by hand. Now a calendar week whose five weekdays are all coded holidays is a *closed week* (`closedWeek` in lib/term) and is not a term week at all: template week *w* lands on the *w*-th open week of the term (`weekMonday`, and its inverse `weekOfDate` for a picked date), so everything after a break slides a week later and the term's last day moves out by a week (`alignOffering` extends the template end by the closed weeks inside it; a coded semester end already allows for them). The weeks a term "gives" are its open weeks, so a break no longer turns week 16 into a beyond-the-term session. This holds under every holiday rule, flag-only included — a break is not a collision to flag. The rule still handles the single closed day inside an open week (Thanksgiving Thursday, Labor Day), and only that; what is left flagged is a day whose every alternative in the week is already taken, or a college set to flag-only. Applied at every place a session is dated: `buildInstances`, the per-cohort session dates the scheduler and coverage use, a student's itinerary, the offering design page, term alignment and course windows, the utilization explorer's conflicts. Only the coded calendar makes a closed week; with no calendar there are none. Tests: `test/holidayrule.test.ts` (closed vs open weeks, open-week counts, week 2 after the break under `weekMonday` and `buildInstances`, a course's own window, the inverse mapping, alignment's end date and course windows).

**The master calendar** (`/calendar`, in the main navigation) is rebuilt as a query surface, not a week strip. One server query (`lib/calendarquery`) dates every session of every non-archived offering of a college with `buildInstances` — the same dates the scheduler, coverage and the design page show — and joins each one to its sections (the weekly booking's room or site, or the site actually booked on an asset by the scheduler's plan), the people staffing it (shift assignments, else the booking's person; preceptors from the students' shifts), the students on it (the shift rows for clinicals, the section rosters for class and lab) and per-occurrence moves. Six views, each a range around a date with ← → that never run out: day (a table, plus who is at which site), week (the time grid), month (a grid with up to four sessions a cell and "+n more"), quarter, semester (the college's own semester, from its anchors) and year (month heat-maps of sessions a day, one hue light→dark, with holidays dotted and closed weeks crossed, and a by-month table and the terms running). One search box finds a student, an instructor or preceptor, a clinical site, a room, an offering, a program or a course, and every view then shows only what touches that thing — a student's own section of each session, a preceptor's shifts, a site's days — with the eight tiles (sessions by kind, student shifts, hours, days, sites, rooms, people, distinct students) recomputed for it; the type and program filters stack on top. Clicking anything opens the session in full (every section: where, who, which students, with each name a further search) and, in the operational module, the weekly pattern behind a section. Conflicts are reported on the dates things happen, one line per clash of two sessions however many sections it touches. The old week-only calendar's query stays behind the utilization explorer. Tests: `test/calendarview.test.ts` (each view's range, the month grid, narrowing to each kind of thing, the roll-ups, the search). Suite: 62 files, 472 tests.

### Offerings by name and place, goals split over classes, and classes that run past the semester (2026-09-21)

**Names.** Lenoir's cohorts came in as the college's sheet has them — "Cohort 26 - 76811" — and Carteret's six as "Class of 2026 (2)", "(3)"…, neither of which says anything. One rule now names every offering, wherever one is made (lock-in, the offering form, the seeds: `lib/offeringname`): a program that graduates a class a year is "Class of <the year its last term ends>"; a short-term program (several runs a year, or twenty weeks or less) is "<start month> · <where it meets>" — "Jan 2025 · Greene County Center", "Aug 2026 · Morehead City" (the main campus goes by its city) — with the days and time of day added only when two runs start the same month at the same place ("Mar 2025 · La Grange Center · Tue & Thu evening"), and a number only after that. The college's own reference (the sheet's section number, 76811) is kept as the offering's `code`, shown beside the name, never in it.

**Where.** An offering now has a place: `Cohort.campusId` (a campus or center of the college — Lenoir's Bullock Building, La Grange, Jones County, Greene County, Kinston High School are campuses already) with a `locationNote` for the building or room, both additive. It is set on the offering page (a "Where it meets" card), on the create-offering form, and on each slot of the goal planner before lock-in; it shows on the Programs tables (a Where column), the offering header, the planner's locked slots and the calendar's search index. The Lenoir seed fills all three from its sheet; Carteret's offerings sit on the main campus.

**Splitting a goal.** Dropping a program on the goal planner put the whole year's goal on one offering and merely noted that the arithmetic wanted six. Now the goal is split evenly, in whole workers, over as many offerings as the program's class size needs (`spreadGoal`, `offeringsNeeded`), each with its own share, a start date spaced back through the year from the latest start that still delivers the goal, and a place; adding or removing an offering re-spreads the unlocked shares, and "spread evenly" does it on demand. The model's card says it in a sentence — one offering is one class of up to N students, run as sections where a session holds fewer (class 10 · lab 10 · clinical 1); a bigger goal takes more offerings, not a bigger class — and each slot says how many sections its seats run as (`sectionsFor`). Tests: `test/goalalloc.test.ts`.

**Continuing-education classes.** A Nurse Aide class that starts in mid-November and runs sixteen weeks was cut at the fall semester's end, its remaining weeks undated and invisible. A program now has a `calendarMode` (additive; `semester` by default): `continuous` runs each term its template weeks straight from the day it is given, across semester boundaries — no snapping to a semester start, no semester end, the next term the Monday after the previous one ends — with holidays and closed weeks still applied. It is set on the program's Design & sequence page (and re-aligns the planned offerings), read by every caller of the alignment engine (lock-in, realign, the offering page's preview, the seeds), and the CNA delivery models of Carteret and Lenoir are seeded continuous (a model with no semester of its own is a continuing-education class). The Semester view lists a term under every semester it touches, so a November start shows in Fall and in Spring. Tests: `test/termalign.test.ts` (a mid-November 16-week class into March under continuous, cut at December under semester; a two-term class back to back).
