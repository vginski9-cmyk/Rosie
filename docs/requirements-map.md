# Structured requirements, setting rules, sites as resources, supervision, AI-assisted inputs and the evaluation service

Phase 14 — recommendations 1, 2, 3, 5, 6 and 7 of the requirements review. Recommendation 4 (agreements) was out of scope; the existing agreement records are reused as they are.

This is the operational record: where each thing lives, what changed, how the migration ran, what the tests prove, what was **not** exercised, and what still needs a human with the real program documents. Nothing in the seeded data is a statement about a real program's regulatory requirements.

## 1. Repository map (where things live)

| Concern | Before | Now |
|---|---|---|
| What a rotation type means | `RotationSetting.settingCode` — one code per wording; "Acute MedSurg or LTC" collapsed to its first setting | `RotationSetting.rule` (JSON `SettingRuleSpec`) + `sourceText` + `interpretationStatus` + `reviewedBy/At` + `revision`; `src/lib/settingrule.ts`; adapter `ruleFromLegacy` for rows that have no stored rule |
| Structured requirements | none (course hours, credentialing sets, ad-hoc panels) | `ClinicalRequirement` → `RequirementVersion` (draft / published / retired) → `RequirementFulfillment`; `src/lib/requirementstore.ts`, `src/lib/requirementactions.ts`, `src/components/RequirementsLedger.tsx` |
| Supervision | `Session.clinicalMode` string + `facultyNeeded` / `preceptorsNeeded` floats | `SupervisionRule` (scope family / program / course / session, `spec` JSON, authority planning / mandatory, revision); `src/lib/supervision.ts`; `SupervisionEditor.tsx`; the legacy columns are still read literally through `supervisionFromLegacy` (never coerced) |
| Sites as resources | `ClinicalAsset` (physical) + `SiteRequirementProvision` (evidence) + `FamilySite` (agreement, `studentsAtOnce`) | same records, plus `SiteCapability` (status supported / limited / unsupported / unknown, limits, learner types, evidence, review date), asset `limitMode` / `availabilityMode` / `timezone` / `capabilities`, family-site `studentsAtOnceMode` / `availabilityMode` / `availability`; `SiteCapabilityPanel.tsx` |
| Import | `importProgramSheet` replaced every session of the program | explicit `merge` (default) / `append` / `replace` with a server-computed preview diff; unmapped columns reported; per-row interpretation notes (`SheetImport.tsx`, `src/lib/actions.ts`) |
| AI-assisted inputs | none | `ExtractionJob` + `src/lib/extraction.ts` (parsers, deterministic proposer, provider adapter, server validation) + `src/lib/extractionactions.ts` + `ExtractionReview.tsx` ("Describe or upload") on Design & sequence and the site page |
| Evaluation | prose reasons inside the scheduler; separate rule readings in demand, capacity, exceptions | `src/lib/evaluate.ts` — checks, aggregation, reason codes, counting, contract, recommendations; run inside `analyze()` in `src/lib/scheduler.ts`; read by the capacity panel, the exception queue and the exports |
| Audit | change sets for calendar / staffing | `auditChange()` kinds `rule-review`, `requirement-publish`, `supervision-rule`, `import-apply`, `extraction-apply` (never undone) |
| Exports | rotation log; program workbook | + "Rules & assumptions" sheet (rotations), + "Setting rules" and "Requirements" sheets (program); every CSV / sheet cell passes `csvCell` (formula-leading text neutralised) |

Schema changes are additive only (`prisma/schema.prisma`; the repo has no migrations directory — `npx prisma db push`). Legacy columns, ids, source strings and snapshots are untouched.

## 2. What each recommendation did

### R1 — structured, versioned educational requirements
- Identity and version (`ClinicalRequirement.key`, `RequirementVersion.version`, unique per requirement), quantity + unit (hours / cases / competencies / shifts — never converted into one another) + basis, setting rule, capabilities, supervision, timing, source text / ref / authority (unknown · unofficial · official), interpretation status, reviewer, publisher.
- Drafts are editable; published versions are frozen; publishing retires the previous one in a transaction; concurrent edits are rejected on `expectedUpdatedAt`.
- The ledger shows **required · represented · unresolved** per requirement and links sessions / courses as fulfillments (a session reaching several settings gets a null amount and a note, never counted twice).
- "Published" is labelled "approved for planning inside Rosie — not regulatory approval" on the ledger and in the export.

### R2 — explicit setting logic
- Rule shapes: `only` · `any-of` · `all-of` (components with own quantities, null = asked) · `pool` (total with minimums) · `n-of` (count, minimum each); plus `mixing` (allowed · forbidden · unknown), `continuity` (one-site · none · unknown), scope. Validated server-side (`validateSettingRule`: known settings, bounded size, no duplicates, minimums ≤ total).
- `proposeRuleFromText` reads the program's wording lexically and **proposes**; a compound wording is always `proposed` / `needs-review`; a single code is `reviewed` only when the legacy row carried exactly that.
- Demand rows carry `rule` + `eligible`; the scheduler's candidate pool is every eligible setting, minimums are seated first, a mixing lock keeps a rotation in one setting when mixing is forbidden or unknown, and `judgeExposure` judges each rotation group by the seat's own setting (a two-tag site never credits two settings for one hour). Unreviewed rules place shifts conditionally (`requirement-unreviewed` blocker, never ready).
- The dropdown UI is replaced by `SettingRuleEditor` (rule summary, source wording, status chip, editor, reviewer name required to mark reviewed, revision check).

### R3 — sites as resources plus educational capabilities
- `SiteCapability` per site × setting / population / procedure / modality with status, limits, learner types, evidence, review date; several capabilities on one asset share that asset's `learnersPerShift` pool (no private copies).
- Limits: `known` · `unrestricted` · `unknown`; availability: `inherit` (resolved source shown) · `specific` · `unavailable` · `unknown`. A blank is unknown, never infinity or zero. Accreditor fields untouched.

### R5 — supervision as an explicit resource model
- Roles (college instructor / site preceptor) with required, staff per group or max learners per staff, named assignment, presence, qualifications, validity, source, status.
- `staffDemand(spec, groups, learnersPerGroup, hours)` — the brief's fixture: 10 learners, 6 h, 1 instructor → 60 learner-h, 6 group-h, 6 instructor-h, 0 preceptor-h; two groups → 2 instructors, 12 h. `overlappingObligations` refuses one person on two groups unless a policy allows sharing.
- `roleFinding` distinguishes not-required · unassigned · assigned-unavailable · no-qualified-person · unknown-qualification · expired · assigned · confirmed with role-specific remedies; planning-scope rules can never drop a mandatory role (`supervisionBook`).
- Staffing panels size the need from the model (`needFromSupervision`) and show "policy missing" instead of zero; the scheduler's Preceptors lever says when no session in the window requires a preceptor.

### R6 — AI-assisted extraction inside the existing import workflows
- Inputs: XLSX / XLSM / XLS, CSV / TSV, pasted cells or text, TXT / MD, text PDF (`pdf-parse`), DOCX (`mammoth`). Scanned PDFs are reported as unreadable (no OCR here); unsupported types get a useful error. Limits on bytes, rows and pages.
- Deterministic parsing keeps `Sheet!A1` / row / `¶N` / `page N ¶M` references and the original text; content hash + source name per job.
- Provider: Anthropic SDK, structured output through `zodOutputFormat`, `effort: "high"`, system prompt with cache control, refusal handling. Configuration: `ROSIE_AI_PROVIDER` (`anthropic` | `none`), `ROSIE_AI_MODEL` (default `claude-opus-5`), `ANTHROPIC_API_KEY` (server-side only).
- Server validation: schema, anchors must match a parsed fragment reference **and** the excerpt must be a substring of it, unknown settings quarantine the item, approval / agreement / verification claims are stripped into questions, negative quantities quarantined, provider "reviewed" downgraded to proposed, suggested defaults flagged. Labels: **parsed — nothing to interpret** · **needs interpretation review** · **unsupported — not applied**; "ready for planning" is only ever earned after review.
- Apply is explicit, idempotent per accepted item, writes drafts / needs-review records through the normal actions, records an `extraction-apply` change set; retry (≤ 5 attempts), cancel, and same-content re-application is allowed on purpose (flagged as a duplicate).
- Uploaded text is data: the system prompt says so, nothing in the source can become an approval, exports neutralise formula-leading cells.

### R7 — canonical deterministic evaluation
- `evaluate.ts`: `checkRequirement`, `checkSetting`, `checkCapability`, `checkAccess`, `checkCapacity`, `checkAvailability`, `checkSupervision`, `checkReadiness`; explicit aggregation (fail > unknown > pass; all n/a → n/a); 40 reason codes with text; `summarize` counts unique placements apart from occurrences and conflicts apart from evidence gaps and assumptions; `recommend` orders remedies by the binding constraint (unreviewed / unresolved requirement → eligible alternatives at excluded sites → access → capacity → only the roles actually required → evidence).
- Run inside `analyze()` for every placed and unplaced section; `plan.evaluation` carries the contract (rules read, input stamp, scope, window, assumptions, population, unit, evaluated-at, complete).
- Consumers: scheduler capacity panel ("Every check, one judgement"), the Preceptors lever, Home's exception queue (REQUIREMENT_UNREVIEWED, QUALIFICATION_UNKNOWN, CAPACITY_UNKNOWN items with the code shown), rotation and program exports (rule statuses and assumptions), staffing panels (policy missing). Site load already reads booked seats shift by shift (previous phase) and is unchanged.

## 3. Migration / backfill

```
npx tsx scripts/backfill-requirements.ts --dry-run   # inventory, changes nothing
npx tsx scripts/backfill-requirements.ts             # repeat-safe; the seed runs the same function
npx tsx scripts/migration-compare.ts                 # legacy vs rules plans side by side (read-only)
```

Dry-run outcome on the seeded database (four colleges):

| | |
|---|---|
| Rotation types | 60 — 44 single codes migrated as reviewed with their existing evidence; 16 compound wordings left **needs-review** (proposed rule, source text kept) |
| Clinical sessions | 402 — 150 supervision models reviewed from explicit mode + counts; 252 flagged for review (unknown mode, or a required role with no count) |
| Family sites | 135 — 29 with a known limit; 106 explicitly **unknown** (never unlimited); availability inherited from the assets |
| Course-hour requirements | 58 course-scope requirements + 4 credentialing-set standards with fulfillment links — 50 with a stated quantity published as v1; **8 whose legacy record says "0 hours" kept as drafts with no quantity and a needs-review note** (missing ≠ zero; a published requirement needs a quantity a person states); discrepancies between coded hours and sessions are listed, not overwritten (e.g. RAD-261 COMP: 33 required, 0 represented) |

The real run wrote 62 requirements, 62 versions, 548 fulfillments, 402 supervision rules and 60 rotation rules; a second run changes nothing (existing rules, versions and supervision rules are never overwritten).

### Old vs new calculation (shadow comparison, roster levers)

| College | Variant | Sections | Placed | Unplaced | Ready share | Sections with alternatives | Unreviewed |
|---|---|---:|---:|---:|---:|---:|---:|
| Carteret | legacy (first setting only) | 86 | 40 (46.5%) | 46 | 0.0% | 0 | 0 |
| Carteret | rules | 86 | **60 (69.8%)** | 26 | 0.0% | 20 | 20 |
| Lenoir | legacy / rules | 265 | 55 (21.5%) | 208 | 0.0% | 0 | 0 |
| Roanoke-Chowan | legacy / rules | 514 | 360 (70.0%) | 154 | 0.0% | 0 | 0 |
| Sandhills | legacy | 21,812 | 13,115 (99.6%) | 90 | 98.7% | 0 | 0 |
| Sandhills | rules (rotation rules only, before course pools) | 21,812 | 13,115 (99.6%) | 90 | **87.8%** | 272 | 2,432 |
| Sandhills | rules + course rotation pools | 21,812 | 13,125 (99.6%) | 79 | **34.9%** | 20,426 | 2,246 |

With course rotation pools (§8) Sandhills' Radiography sections read the pool rule instead of "GEN only": 20,426 sections now have alternatives, placed count rises slightly, and ready share falls to 34.9% because the evaluation exposes a **conflict in the seeded requirements**: 5,867 placements carry SETTING_MINIMUM_UNMET. The per-area minimums of RAD-161 (240 h of minimums in a 240 h course) and RAD-251 (329 h in 336 h) need 34 of 32 and 43 of 42 whole eight-hour sessions — a session is one setting per shift, so no split of those courses' sessions can satisfy every minimum. The course block says so on each requirement ("whole sessions the minimums need: 43 of 42 … adjust the area hours or the session length"). This is a newly exposed conflict in the seed's area hours, not a regression of the engine: the legacy calculation hid it by placing every Radiography shift in GEN.

Classification: Carteret's twenty extra placements are a **corrected interpretation** (the OR wording now reaches LTC seats) that is at the same time a **newly exposed unknown** (the rule is unreviewed, so those placements are conditional, ready share stays 0%). Sandhills' lower ready share is a **newly exposed unknown** — 2,432 sections sit under compound wordings nobody has reviewed. Lenoir and Roanoke-Chowan are unchanged (single-setting rotations). No regression was found: placed counts never fell. Ready share at Carteret and Lenoir is 0% in both variants because no instructor is on record for those colleges' sessions (INSTRUCTOR_UNAVAILABLE) — pre-existing data, not a change.

Compatibility: rows without a stored rule are read through `ruleFromLegacy`, so every live view is on the rule engine; rollback is `git revert` of the phase-14 commits plus leaving the additive columns in place (nothing reads them then).

## 4. Tests

```
npx tsc --noEmit -p tsconfig.json     # clean
npx vitest run                        # 69 files, 546 tests, all passing
```

Acceptance tests (brief §12) and where each is proven:

| # | Result | Evidence |
|---|---|---|
| 1 | pass | `settingrule.test.ts` 1; `schedulerrules.test.ts` 1 (ten sessions land in LTC, demand 100 learner-shifts, ready 100) |
| 2 | pass | `settingrule` 2; `schedulerrules` 2 (placed conditionally, `requirement-unreviewed`, nothing ready) |
| 3 | pass | `settingrule` 3 |
| 4 | pass | `settingrule` 4; `extraction` free-text "&" asks for quantities |
| 5 | pass | `settingrule` 5; `schedulerrules` 5 (minimum seated first) |
| 6 | pass | `settingrule` 6; `schedulerrules` 6 (`mixing-locked`; unknown mixing also locked) |
| 7 | pass | `settingrule` 7; `schedulerrules` 7 (`setting-rule-unmet`, CONTINUITY_UNMET) |
| 8 | pass | `settingrule` 8 |
| 9 | pass | backfill: fulfillment amount null when a session reaches several areas; ledger sums once (`requirementstore.requirementLedger`) — unit test not written; verified by the dry-run discrepancy list |
| 10 | pass (existing) | shared `learnersPerShift` pool per asset; `scheduler.test.ts` seat accounting |
| 11 | pass | `schedulerrules` 11 |
| 12 | partial | the contract carries `complete` and SOLVER_INCOMPLETE exists; the greedy solver always finishes, so no path sets `complete: false` today |
| 13 | pass | `evaluate` 13 |
| 14 | pass | `evaluate` 14 |
| 15 | pass | `supervision` 15; `workload` needFromSupervision |
| 16 | pass | `supervision` 16 |
| 17 | pass | `supervision` 17; `schedulerrules` 17; evaluation `rolesRequired` = instructor only |
| 18 | pass | `supervision` 18 |
| 19 | pass | `supervision` 19 |
| 20 | pass | `evaluate` 20; `schedulerrules` scenario test (SCENARIO_ASSUMED_ACCESS is an assumption; pass count 0) |
| 21 | pass | `supervision` 21; `schedulerrules` unique-vs-occurrences |
| 22 | pass | `settingrule` 22 |
| 23 | pass | backfill discrepancy list; `RequirementsLedger` shows unresolved; nothing overwritten |
| 24 | pass | `supervision` 24; `extraction` 24 |
| 25 | pass | `extraction` 25 |
| 26 | pass | `extraction` 26 (schema failure → explicit state, no items); job persistence and retry are server paths (not unit-tested) |
| 27 | pass (code) | `previewProgramSheetImport` / explicit `replace` mode; **no automated test** (DB path) |
| 28 | pass (code) | every action validates scope, rule shape, reviewer, revision server-side; **not tested against a running server** |
| 29 | pass (code) | `expectedRevision` / `expectedUpdatedAt` checks; **not tested** |
| 30 | pass | backfill run twice on the seeded DB: counts unchanged |
| 31 | pass (manual) | rules, capabilities, supervision saved through the UI persist and change `ruleBook` / scheduler results on the next request; no automated e2e |
| 32 | pass (code) | one `plan.evaluation.contract.inputVersion` + `requirementVersions` per run; exports print the same statuses; not automated |
| 33 | unchanged | the existing apply-design path is untouched; no new test |
| 34 | not done | scope-filter cohort reset was not changed or tested in this phase |
| 35 | pass | `extraction` 35; `csvsafe` |

AI evaluation corpus (`test/extraction.test.ts` CORPUS): OR, AND, minimums, contradictory totals, missing supervision, estimated site volume, instruction injection — expected fields, expected questions, valid anchors; unsupported-assertion handling measured through `validateProposal.stats`.

**Not run:** a live provider request. No `ANTHROPIC_API_KEY` is configured in this environment, so every extraction job ran the deterministic proposer (`provider: none`). The Anthropic path is implemented against the installed SDK (`@anthropic-ai/sdk` 0.127) and compiles, but it has not been exercised against the API. OCR is not available; scanned PDFs are refused with a message.

## 5. Before / after (synthetic fixtures)

**OR eligibility.** Rotation "Acute MedSurg or LTC", ten six-hour sessions, hospital med-surg unit with no seats, SNF with ten LTC seats.
- Before: settingCode = BEDS → every session unplaced ("closed that day" at the hospital); LTC seats invisible.
- After, rule proposed (unreviewed): all ten placed in LTC, flagged `requirement-unreviewed`, ready 0 of 100, evaluation REQUIREMENT_UNREVIEWED on 10 placements.
- After, rule reviewed as any-of with mixing allowed and a known limit: all ten placed, ready 100 of 100, evaluation 10 pass.

**Instructor-led staffing.** Instructor-led group, 10 learners, 6 h, faculty 1, preceptors 0.
- Before: "unprecepted" blocker text and remedy spoke of preceptors; the Preceptors lever looked applicable.
- After: need = 6 instructor hours, 0 preceptor hours; blocker example reads "no instructor by name"; remedy "assign a qualified college instructor …"; the lever says no session requires a preceptor; `rolesRequired = ["instructor"]`; no recommendation mentions preceptors.

## 6. Remaining human validation (never fabricated here)

- The 16 compound rotation wordings (e.g. Sandhills "Chest & Bone"-style pairs that resolve to one setting were auto-reviewed; genuine "A or B" / "A & B" wordings are not): a program lead must confirm the alternatives, whether hours may be mixed, and one-site continuity, then mark them reviewed with their name.
- 252 clinical sessions whose supervision model needs a decision (unknown mode, or a required role with no count).
- 106 secured site agreements with no students-at-once on record: enter the agreed figure or mark the field explicitly unrestricted.
- Course-hour vs session discrepancies listed by the backfill (RAD-261 and others), and the 8 course areas whose record says "0 hours": no requirement here, or an unstated minimum?
- Source authority: every backfilled requirement is `sourceAuthority: unknown` until someone attaches the official document.
- No AI output has been reviewed by a person because none was produced by the provider in this environment.

## 8. The template is the source of truth (follow-up)

The first cut kept the requirements in a ledger beside the template with hand-kept session links. That was the wrong shape: the course and session rows of Design & sequence are where a program lead already works, so the requirement facts now live there and the roll-ups are derived from them.

- **Course block → "Clinical requirements of this course"** (`CourseRequirements` in `src/components/RequirementsLedger.tsx`): the course's requirements are fields of the course — quantity per learner, unit, where (the setting rule), source authority, reviewer — with draft → publish inline. The closed course row carries a chip (`3 req · met` / `20 h short` / `2 shares to state` / `1 to review`).
- **Represented is derived, never linked by hand** (`src/lib/requirementcoverage.ts`, tested): a session counts toward a requirement when its rotation's setting rule reaches a setting the requirement's rule allows. A session reaching several requirements of the course is *shared* and counts for nothing until a person states its split (an inline "state share" field) — never an even guess. A cases requirement is never derived from hours. The backfill no longer writes fulfilment links; the 548 it had written are ignored and were removed locally.
- **Session rows carry the AND / OR tags** (`SessionSheet`): every clinical row shows the setting rule its rotation type means with its status chip, and the open row holds the rule editor itself (only A · A or B · A and B · minimums inside a total · any N of; mixing; one site) — the same shared rule every session with that rotation type reads.
- **Automatic tagging from the taxonomy**: a rotation wording nobody has mapped is tagged against the college's setting taxonomy (`proposeRuleFromText`) as a *proposed* rule — in demand (`clinicalDemandRows`, so the scheduler and capacity views reach every eligible setting at once, conditionally) and on the session row (marked "tagged automatically — not saved yet", one save keeps it for review). Wording that matches nothing stays unmapped.
- **Eligible settings and sites per session**: under the rule, each eligible setting code is listed with its taxonomy name and the college's sites that carry it (assets, seats per shift, the family's agreement), sorted secured first. An unreviewed rule says these are where shifts would go conditionally, not where they are approved to go.
- **Course rotation pools** (`coursePools` in `src/lib/requirementcoverage.ts`, `coursePoolRules` in the store): some templates tag every clinical session of a course generically ("Other (imaging rotations)" → GEN) while the course's requirements spread hours across settings no session is tagged for (ED, PORT, OR, FLUORO, CT). Those sessions cannot be matched setting by setting, so the course's clinical hours are one pool: an explicit `pool` rule over every requirement setting with the quantities as minimums (reviewed only when every requirement is), read by the scheduler (minimums seated first), the capacity view and the session rows ("This course's rotation pool"); coverage allocates the pool's hours to the requirements in order and shows whether the total suffices. The per-session tagging stays an open question the row states — nothing is invented. Radiography at Sandhills is the case in the seed: five courses, pools of 96–336 h against 96–303 h of minimums.
- **Two new template columns**: `Session.experiences` (populations / procedures / modalities the session must include — the rule says *where*, this says *what*) and `Session.progression` (Orientation · Observation · Assist · Perform · Independent with supervision · Capstone). They are editable in the row, import through the sheet importer (header synonyms "experiences", "procedures", "progression", "stage", "scrub role"…), export in the Raw Data sheet, and the extraction proposes them when a document states them.
- **Program-wide and family standards** stay in a short collapsed summary above the terms (totals per unit, interpretations to review, quantities not stated).

## 9. Accuracy audit (follow-up)

`scripts/audit-accuracy.ts` recomputes every clinical total independently from the raw rows and cross-checks the template, the dated demand, the scheduler's plan, the roster on the calendar (bookings and student shifts), the capacity view, site load, site caps, staffing and the requirements. It is read-only and runs per college:

```
npx tsx scripts/audit-accuracy.ts            # every college
npx tsx scripts/audit-accuracy.ts Sandhills  # one college
```

What it checks: demand students = min(enrollment, sections × max) per dated row; dated rows inside their term and on their weekday; assets and rules inside the setting taxonomy; placed + unmet = demand; no asset-shift over its learners per shift or on a closed shift; a section's parts add up and its seat ranges never overlap; every placement in an eligible setting, within the Day lever, at a secured site, never on a holiday; no student in two places at once; preceptors belong to the site and are never double-booked; the family's students-at-once never exceeded; the plan's supply figure equals an independent count; the roster's bookings never over-fill an asset-shift; every pinned student shift has the booking behind it; site load's seated count equals the roster's; the capacity view's demand and supply equal the scheduler's on the same rows; and every course pool's minimums fit its hours.

**Defects it found, all fixed:**

| Defect | Effect before | Fix |
|---|---|---|
| A demand unit's identity did not include the offering, and two offerings of one program share session ids (Sandhills runs a "2nd class" for each Radiography year) | Every count keyed by unit id — placed shifts, evaluation placements, unmet grouping — merged the two offerings: the scheduler reported 13,125 placed shifts for 21,733 placements | `DemandUnit.id` = cohort · session · section · date |
| Per-occurrence moves were keyed without the offering | A move on one offering also moved its sibling's shift on the same date | moves carry `cohortId`; lookup is cohort-scoped |
| An applied plan's own moves fed the next plan as if a person had made them | Every re-apply started ± 2 days from the previous plan's dates and could drift another ± 2 (8,254 auto-plan moves at Sandhills after one refresh) | the scheduler ignores `auto-plan` moves; hand-made moves are still honoured |
| Re-applying a plan rewrote the past | Bookings, moves and staff for dates already worked were deleted and re-created; logged (completed) shifts kept pins to bookings that no longer existed (1,252 orphan pins) and site load counted them as seats, reading 234 asset-shifts over 100% | `writeSchedulerPlan` takes a cutoff (default today): history is never re-planned; under an explicit full replace a logged shift's seat follows the new booking |
| Site load counted a pin without a booking as a seat | Over-100% asset-shifts that did not exist | a seat is a booking; a pin without one is unseated on its pattern date |
| The scheduler's own supply summary counted seats in each section's primary setting only, while placements used every setting the rule allows | "87.5% can be placed" beside "supply at the sites that count 0.45×": a Radiography pool over GEN / ED / PORT / OR / FLUORO / CT was measured against GEN seats alone (5,238) although 10,177 learner-shifts were placed; per-setting balance rows charged all pooled demand to GEN, so GEN read short and its utilization could exceed 100% | supply on demand days counts every eligible setting (16,493 for that scenario, 1.42× demand); balance and week rows attribute each section to the setting it landed in, so rows add up to the whole and utilization never exceeds the seats used; audit checks B9 |
| The capacity view matched demand to its primary setting only | Demand a rule allowed in an alternative setting read as "physically short" (225 learner-shifts at Sandhills) while the scheduler placed it | `assetMatch` allocates per date × block across the eligible settings, primary first, counted once (`hostedInAlternatives`) |
| The "minimum first" preference refused every other eligible setting once the minimum's setting had an asset at all, free or not | Under the base levers (secured, within 30 min, exact shift, exact date) a day with 40 Radiography students and 24 eligible seats placed 11: GEN's three rooms filled and the 13 ED / PORT / OR / FLUORO seats beside them stayed empty while 29 students read "full" | the minimum's setting goes first only while a pool of it can seat the whole section; otherwise every eligible setting competes (a scoring bonus keeps the minimum preferred). That scenario: 6,496 → 6,912 placed of 11,640; the roster plan 21,739 → 21,776 of 21,812 |
| A site's approved students-at-once was reported as "every open asset is already full" | Moore Regional's 16-student cap bound on every day its 20+ eligible rooms did not; 3,184 learner-shifts were counted as room shortage | a new unmet reason `site-cap` ("free rooms, students-at-once reached"), with its own fix line; audit B9c warns when an unplaced "full" shift sits beside a free eligible seat |
| "Seats at the sites that count" was the only supply ceiling, and it sums rooms over the window whether or not they fall where the students are | 8,775 seats (0.75×) beside 55.8% placed read as a contradiction: every one of the 291 demand days was short of seats, so the sum could never be reached | `supplySeatsLinedUp`: seats matched to demand shift by shift (week by week and across blocks where the Day and Shift levers let a shift move), each site at its students-at-once, never beyond that shift's demand. That scenario: 6,984 lined up, 6,912 placed — the 72 between them are three class days. The panel draws it as the bar the placed share is measured against; audit B9b holds placed ≤ lined up ≤ supply. The raw rooms bar was then retired from the panel altogether, and the preceptor and every-site ceilings rebuilt on the same lined-up basis (`supplySeatsLinedUpStaffable` ≤ `supplySeatsLinedUp` ≤ `supplySeatsLinedUpEverySite`), so the three bars are comparable; the raw fields stay on `CapacityHeadroom` for the per-setting table and the audit |

**Audit result after the fixes (all four colleges): 0 errors.** Section H (2026-09-22) checks every graduated class: terminal statuses, completion dates and GPAs, stage actuals through productive, no scheduled history, seated completed shifts, completed rotations. Remaining warnings are data, not engine: sessions dated one or two days after their offering's stated term end (Carteret NAS 111 #10, three Lenoir CE offerings, Sandhills SUR 135 #30 — the term end date is short of the template's last week), and future student-shifts without a booked seat, which are the plan's unplaced sections plus named students beyond the seats the plan booked.

Regression tests: `test/scheduler.test.ts` (cohort-scoped units and moves; auto-plan moves ignored), `test/assetmap.test.ts` (allocation across eligible settings).

## 7. Known limitations

- Test 34 (scope-filter cohort reset) not addressed. Test 12 has no path that produces an incomplete evaluation.
- Server-bypass, concurrency and persistence tests (28, 29, 31) rest on code review and manual checks, not automated end-to-end tests.
- `capacity.ts` program-level demand still multiplies `sections × preceptorsNeeded` from the legacy columns; the new model is applied at the offering / staffing level and in the scheduler, not in that roll-up.
- The exception queue derives its requirement findings from records, not from a full scheduler run per college (kept cheap for the Home page); the scheduler's own evaluation is the authoritative per-placement judgement.
