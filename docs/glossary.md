# Rosie glossary

One term per concept, used the same way on every screen. Generated from `src/lib/glossary.ts` (`npm run glossary`); the same content is on the site at `/glossary`. Retired words are ones that used to mean the same thing somewhere in the UI and no longer appear.

## Programs and the people in them

### Program family

Every program at one college that trains for one occupation — Radiography at Sandhills, Nurse Aide Level I at Lenoir. The family owns the North Star goal, the health rates, the credentialing body's requirement set and the agreements with clinical sites.

- **Retired:** family (short form is fine), delivery-model group
- **Not the same as:** The occupation (the target job) is what the family trains for; the family is the college's set of programs for it.
- **Where:** Home, the program workspace, the clinical hub

### Program

One designed structure inside a family: its terms, courses and sessions, the maximum cohort it can hold, and the workbook it was imported from. "Nurse Aide Level I — 6-week offering" is a program; the family Nurse Aide Level I has six of them.

- **Retired:** delivery model, model
- **Not the same as:** The design pages still say "template" for the program's structure as designed, as opposed to an offering's dated copy of it.
- **Where:** Programs, Design & sequence, the goal page's program cards

### Offering

One dated run of a program: a start date, term dates on the college calendar, section bookings, staff, and the students in it. An offering is what the goal page locks in and what the calendar, staffing and scheduler count.

- **Retired:** instantiation, class, run
- **Not the same as:** A cohort is the students in an offering, not the run itself.
- **Where:** Programs › Offerings, the goal page, every Insights view

### Cohort

The students enrolled in one offering, as a group: cohort size, maximum cohort, "the cohort splits into four sections". Cohort names ("Cohort 39", "Class of 2028") name the offering's students.

- **Not the same as:** Not a synonym for the offering. Say offering for the dated run and cohort for its people.
- **Where:** Enrollment figures, section splits, the students page

### Graduated class (history)

An offering whose last day has passed. It is a record like any other: its roster carries where every learner ended (withdrawn, completed, licensed, placed, fully productive) with completion dates and grades, its clinical shifts are logged on the seats they were booked on, its rotations are marked completed, and its funnel actuals run through fully productive. Nothing drops it by status — the calendar, coverage, site load, the analytics and its own page keep it as history; a forward-looking page narrows by date (the classes whose terms overlap its window), never by status.

- **Retired:** completed cohort (as a class that no longer counts)
- **Not the same as:** Archived: an offering withdrawn from the record altogether.
- **Where:** Every students view and picker, the goal page (Outcomes by class), Home (the latest class against its goal), site load, the offering page

### Term and semester

A term is a block of weeks in a program's structure (Term 1 … Term 5); the offering places each term on real dates. A semester is the college calendar period a term lands in (Fall 2026).

- **Where:** Design & sequence, the offering's term dates, the academic calendar

### Session

One recurring meeting type of a course as designed: class, lab or clinical, with its length in hours, the most students it can hold, and the faculty, support staff and preceptors one run of it needs. Sessions are what one student sits through.

- **Where:** Design & sequence (Sessions row), the course page

### Course section

One of the groups a session's enrollment is split into when it exceeds the session's maximum: ROUNDUP(enrollment ÷ max students). "Section 2 of 4". A student sits in one section per course kind.

- **Retired:** group
- **Not the same as:** A section is a group of students; a shift is that group on one date.
- **Where:** Students › sections, the offering's weekly pattern, the master calendar's section table

### Section booking

A section's weekly slot on the calendar: day, time, room or clinical site, and the people who staff it. One booking per section per course kind; the master calendar, the offering page and the coverage view all edit the same record.

- **Retired:** meeting, meeting pattern, weekly pattern (the set of bookings)
- **Where:** The offering's weekly pattern, the master calendar, a site's "Booked here"

## Shifts, seats and bookings

### Shift

One section on one date — a dated occurrence of a session. "Shifts needed" is each session run as many times as its capacity needs (class, lab and clinical), and a clinical shift is the unit the scheduler places at a site. A shift needs a room or site and a person to run it.

- **Retired:** section (for a dated occurrence), section-meeting, section-shift, occurrence
- **Where:** Design & sequence (Shifts row), the scheduler, coverage, staffing

### Learner-shift

One student on one shift: a seat on a date. The scheduler's demand is counted in learner-shifts and learner-hours.

- **Where:** The scheduler's Demand tile and bottlenecks

### Asset booking

A site's asset — a room, unit or machine — reserved for a shift on a date and shift block (day, evening, night). Applying a scheduler plan writes asset bookings; they are not learner-shifts.

- **Where:** The scheduler's apply notice, clinical site capacity

### Student-attendance

One student counted once for each session they attend that day. Daily coverage shows distinct students (each person once) and, beside it, student-attendances: on Aug 17, 2026 the 59 radiography students (19 on a clinical shift, 40 in class and lab) plus 19 surgical technology students in class are 78 students and 118 student-attendances.

- **Where:** Daily coverage

### Clinical placement

A section or a student placed at a clinical site for a shift or a rotation. Always say clinical placement; a placement on its own is ambiguous.

- **Not the same as:** An employment placement is a graduate in a job.
- **Where:** The scheduler, the coverage view's clinical chips, the rotation board

### Employment placement and work-based learning placement

An employment placement is a graduate placed in a job — the funnel's "retained & placed in a regional job" stage. A work-based learning placement is a student's employer placement recorded on the student page (planned, active, completed), separate from their clinical shifts.

- **Not the same as:** Neither is a clinical placement.
- **Where:** The talent pipeline, the student page, a site's "Booked here"

## Staffing

### FTE — cumulative vs peak concurrent

A full-time equivalent of contact hours. Cumulative semester-FTE adds each term's FTE over the whole program (73.8 preceptor FTE is a budget total across five terms, not people on site at once). Peak concurrent FTE is the busiest week ÷ the work week: the people needed at the same time. Both are labeled as such.

- **Where:** Design & sequence, instructors & preceptors needed

### Faculty vs preceptor

Faculty (instructors and support staff) are college-paid and cover class, lab and instructor-led clinicals. Preceptors are a partner site's own staff supervising students on a precepted clinical, typically one to one. The two are never added into one figure.

- **Where:** Every staffing view

### Supervision on a shift (instructor · preceptor · supervised by · hours received)

One record with two roles on every clinical student-shift: the college instructor and the site preceptor, each named from the plan's or the log's pin, else the section's usual lead staff of that role. Supervised by reads instructor named, preceptor named, instructor and preceptor, nobody named, or none required — a role the template's supervision model does not ask for is never a gap. The time is stated per shift: the role's hours on the shift (the whole shift for a whole instructor or a preceptor; a fractional instructor figure, such as Radiography's 0.04 on a precepted rotation, is that fraction of the shift — oversight, with nobody named per shift), the learners on that shift, and this learner's share (hours ÷ learners), credited only when someone is named in the role (or the role is oversight) and only to a learner who was on the shift. Summed over a site, a person or a class, the shares add back up to the time a named supervisor gave.

- **Not the same as:** Not the shift length × learners: an instructor with ten learners for six hours gave six hours, 0.6 to each — the site load, the rotation export, the offering ledger and the exception queue all count it that way.
- **Where:** Clinical site load (Instructor, Supervision model, Supervised by and Learners per supervisor dimensions; Instructor hours and Preceptor hours measures; the CSV), the rotation export, the offering ledger, the exception queue

### Instructor-led vs precepted clinical

An instructor-led clinical is a section supervised by college faculty at a site (one instructor per section). A precepted clinical pairs each student with a site preceptor, so each student is their own shift and clinical placement.

- **Where:** Session design, coverage, the scheduler

## Goals and the talent pipeline

### North Star goal

How many fully productive workers a family must add to the region in a year. Everything upstream — enrollment capacity, offers, qualified applicants, interested candidates — is derived from it by the health rates.

- **Where:** Home, the goal page

### Required count (pipeline target)

The number a pipeline stage must reach for the goal to hold. Required counts round UP on screen and read "at least 83" when the calculation is fractional; hover a target for the calculation. Actuals are counts of real students and never round up.

- **Where:** The goal page, the offering funnel, the pipeline analytics board

### Health rates

The conversion rates between pipeline stages (enrollment rate, completion rate, licensure pass rate, placement rate, productivity rate) and the surpluses above capacity (interested, qualified, offered). Family defaults; an offering may carry its own.

- **Where:** The goal page, the offering's targets editor

## Clinical sites and supply

### Clinical site (partner)

An employer that hosts clinical shifts. Its agreement with the college is none, prospect, asked, secured or declined; a family may hold its own agreement with the site, which wins over the institution's. A college's partner record is its own relationship with the site: the agreement, contacts, the drive time from its campus and the assets it may use.

- **Retired:** employer (as the noun for a hosting site)
- **Not the same as:** The site itself, which lives once in the site registry whichever colleges approach it.
- **Where:** Setup › Clinical sites & partners, a site's page, the family's site setup

### Site registry

Every clinical site in the world the platform knows, once: its name, system, facility type, address and beds. Several colleges can court the same hospital; each keeps its own partner record linked to the one registry record, and sees the others doing it.

- **Where:** Capacity › Site registry, the Setup page's "add a site" picker, the shared-site chip on a site's page

### Asset and setting

An asset is a room, unit or machine at a site with a setting code (GEN, ORS, ED …), the days and shift blocks it runs, and the learners it hosts per shift. A setting is the kind of clinical experience an asset provides; a program's service areas map to settings.

- **Where:** A site's assets, clinical site capacity, the scheduler

### Supply ceiling, hostable, placed

The scheduler's supply ceilings are the three lined-up bars (see "Seats that line up with the demand"): seats matched to the demand shift by shift at the sites that count, of which a preceptor could cover, and if every site counted. The raw window total — every asset-shift × learners per shift, whether or not a section falls on it — is a theoretical maximum, not usable capacity; it appears only as the per-setting table's allowed seats. Hostable by secured sites is the part of demand that fits at sites with a secured agreement. Placed is what the scheduler actually put on an asset under its levers; seats-only placement is exploratory (nobody may be free to precept).

- **Where:** The scheduler's supply bars and per-setting table, clinical site capacity, site load

### Seat, shift and "full" (site load)

A seat is one learner place on one asset for one shift block on one date — an asset with learners per shift 2 opens two seats on each shift it runs. The roster is placed seat by seat by the scheduler (the seed places the demo roster the same way, under the roster levers), and the site-load page reads those seats back: each student-shift carries the asset, the shift block and the date it was booked on. "Full" is measured shift by shift: students on a shift ÷ seats open that shift in the programs' settings, summed over the shifts the site hosts — a Day shift against Day seats, never an average over the day — and the fullest single shift is shown under it. A student-shift the scheduler could not seat is shown as "no seat yet" at its section's pattern site and is never load on that site's seats. Because the scheduler never places over an asset's learners per shift or a site's students-at-once, a site can only read over 100% on a shift where someone booked by hand.

- **Retired:** seats per day, students per day as the fullness measure
- **Where:** Clinical site load (the Full column, the seat-by-seat panel, the Seat / Shift / Asset dimensions), the scheduler's "on the calendar now" line

### Base levers and roster levers

The base levers are what the scheduler opens on — the strict reading: secured sites only, within 30 minutes of campus, the exact shift block and the exact date the template says, never on a holiday, seats first (a site's preceptor goes on the shift when it has one; none is required to place it). Every loosening from there is a choice made on the levers card; "reset to the base levers" returns to it. The roster levers are the looser set the roster on the calendar was placed with — every secured site at any drive time, any shift block, ± 2 days inside the week — so the calendar can read higher than the base estimate; the line under the levers says which levers differ, and "roster levers" shows the calendar's own reading.

- **Where:** The scheduler's levers card, the seed

### Seats that line up with the demand

The scheduler's supply ceiling, in three bars on one basis. A seat is one learner place on one asset on one date and shift block, in a setting the rotation's rule allows. Seats are matched to the demand shift by shift (week by week, and across shift blocks, where the Day and Shift levers let a shift move): each site is held to its approved students-at-once, and no shift's seats count beyond what that shift needs — a seat on a day nobody needs it, or the twenty-fifth seat on a day forty students need twenty-four, is not lined up. The first bar counts the sites the Sites-that-count and Drive-time levers allow; placed can never exceed it, and between it and placed sit only class-day, holiday and students-due-elsewhere clashes and sections too big for one site. The second holds each site and shift to the preceptors on its roster × students per preceptor (never above the first). The third counts every live site whatever its agreement or drive time (never below the first) — what loosening the Sites and Drive-time levers all the way could unlock.

- **Where:** The scheduler's supply bars and "how to read these numbers"

### Requirement set, item and provision

The credentialing body's list for a family (ARRT competencies, AST case categories, CMS hours): the set, its items (each with a category, mandatory or elective, and the settings that can provide it), and a provision — whether a given site provides an item, confirmed with the site, estimated, or only inferred from its assets. A case-log standard's rules (total volume, the First Scrub role, a spread of specialties) are scored as requirement lines beside the items.

- **Where:** The clinical hub's requirements panel, a site's provision checklist, the student's requirement log

### Evidence status

How well a site-experience capability is known, on one ladder: inferred (the asset map implies it, or someone entered an estimate), confirmed (the site said so — a VERIFIED record with who and when), committed (confirmed, with a secured agreement, accreditor recognition where required, and a capacity figure on record), scheduled (a booking exists), verified complete (a preceptor-verified student log). Every headline is computed from the weakest required input: "Potential coverage identified for 42/42. Confirmed: 0/42." Only confirmed and above may read as success. Unknown (no asset, no answer) is neither zero nor available, and a service line a generic asset does not imply reads "possible" until the site confirms it.

- **Retired:** covered (as a success word for an inferred provider)
- **Where:** Every coverage headline, the requirements panel, a site's setup steps and provision checklist

### Scope strip

The line above every capacity, coverage, staffing and scheduler view saying what the numbers are (requirements, a proposed scenario or the applied plan), whose enrollment they count, the date window, the constraints enforced, when they were computed, and why a sibling view differs.

- **Where:** Insights

## Requirements, rules and the evaluation

### Setting rule

What a clinical rotation type means in settings, as a structured rule rather than one code: only A; A or B (alternatives for the same hours); A and B (both, each with its own quantity); a total with minimums inside it; any N of a list; plus whether hours may be mixed across settings and whether the rotation must stay at one site. The program's own wording is kept beside the rule.

- **Retired:** rotation mapping, setting code (as the whole meaning)
- **Not the same as:** An alias — two names for one setting — is not a substitution. "Acute MedSurg or LTC" proposes alternatives; it never approves them.
- **Where:** Clinical site capacity › rotations, the requirements ledger, the scheduler, exports

### Interpretation status (proposed · needs review · reviewed)

Whether a person has confirmed what a rule or requirement means. Proposed and needs-review rules still drive planning, but every shift placed under them is conditional — never ready. Reviewed means a named person confirmed the interpretation on a date; it is not regulatory approval.

- **Not the same as:** Not the same as a published requirement version (approved for planning inside Rosie) and not the same as an official source.
- **Where:** Rule editors, the requirements ledger, the exception queue, the scheduler's blockers

### Requirement version (draft · published · retired)

A structured educational requirement — quantity, unit and basis, setting rule, capabilities, supervision, timing, source and evidence — kept as numbered versions. A draft can change; a published version is frozen and is what planning reads; publishing a new one retires the previous. Published means approved for planning here, not approved by a regulator.

- **Where:** Design & sequence › requirements ledger, the program export's Requirements sheet

### Required · represented · unresolved

For a requirement: the published quantity (required), the amount the design's sessions and courses are linked to it for (represented), and the difference (unresolved). Hours, cases and competencies are never converted into each other.

- **Where:** The requirements ledger

### Supervision model

Which roles a clinical session requires and how they are sized: college instructor and/or site preceptor, required or not, people per group or the most learners one person may supervise, named assignment needed or not, presence, qualifications and validity dates. Instructor-led, preceptor-led and combined are the recognized modes; anything else stays needs-review — never coerced.

- **Retired:** clinical mode (as the only record)
- **Not the same as:** Qualified, available, assigned and confirmed are four different facts about a person; none implies the others.
- **Where:** Design & sequence (clinical rows), staffing panels, the scheduler

### Policy missing

A role the supervision model requires but has no count or ratio for. The need is unknown — reported as a question — never sized as zero.

- **Where:** Staffing panels, the exception queue, the scheduler's evaluation

### Site capability (supported · limited · unsupported · unknown)

Whether a site provides one educational experience (a setting, a population, a procedure or a modality), with limits, learner types, evidence and a review date — separate from the site's accreditor recognition and from its physical assets. Several capabilities on one unit share that unit's capacity pool; nobody gets a private copy of shared supply.

- **Not the same as:** Confirmed / inferred evidence status stays a separate fact about how the capability is known.
- **Where:** The site page and family site setup › capabilities

### Limit mode (known · explicitly unrestricted · unknown) and availability mode

What a blank number means. A students-at-once limit is a known figure, explicitly unrestricted by this field (other limits still apply), or unknown — never silently unlimited or zero. Availability is inherited from the assets' schedules, set specifically, unavailable, or unknown, and the resolved source is shown.

- **Where:** Family site setup › availability, the scheduler's capacity and availability checks

### Evaluation (pass · fail · unknown · not applicable)

One deterministic judgement every view shares: each placement checked on requirement, setting, capability, access, capacity, availability, supervision and readiness. Any fail → fail; else any unknown → unknown; all not-applicable → not applicable. Every finding carries a reason code (REQUIREMENT_UNREVIEWED, SETTING_INELIGIBLE, ACCESS_UNSECURED, CAPACITY_EXHAUSTED, INSTRUCTOR_UNASSIGNED …), and the same code appears on the scheduler, the exception queue and the exports.

- **Where:** Scheduler › every check, one judgement; Home › what needs fixing; rotation and program exports

### Conflict, evidence gap, assumption

A conflict is demonstrated (a seat over its limit, a role unassigned). An evidence gap is a fact nobody has recorded (a limit, a confirmation, a policy) — not proof either way. An assumption is a lever the reader chose (asked agreements counted as access). Counted by unique placements first, then by occurrences.

- **Where:** The scheduler's evaluation panel

### Experiences and progression stage (session columns)

Two template columns on a clinical session beside its rotation type: the experiences it must include (populations, procedures or modalities — what, where the setting rule says where) and its progression stage (orientation, observation, assist, perform, independent with supervision, capstone — when). They import, export and extract like every other workbook column.

- **Where:** Design & sequence session rows, the Raw Data export, Describe or upload

### Eligible settings and sites (tagged from the taxonomy)

For a clinical session, the setting codes its rotation rule allows and the college's sites that carry each of them (assets, seats per shift, the family's agreement). A rotation wording nobody has mapped is tagged automatically from the setting taxonomy as a proposed rule, so demand reaches every eligible setting at once — conditionally, until a person reviews it.

- **Not the same as:** Eligible is not approved: under an unreviewed rule the sites are where shifts would go conditionally.
- **Where:** Design & sequence session rows, the scheduler's candidate pool, the capacity view

### Extraction proposal (parsed · needs interpretation review · ready for planning)

What "Describe or upload" produces from a workbook, a document or plain words: candidate sessions, rules, requirements, supervision models and site capabilities, each anchored to the source fragment it came from, with the questions a person must answer. Parsed means transcribed and validated; needs interpretation review means a human decision is missing; ready for planning is only ever earned after review. Applying writes drafts and needs-review records, never active facts.

- **Not the same as:** A model's confidence is not evidence; a reviewer's acceptance of a transcription does not make an unofficial document official.
- **Where:** Design & sequence and the site page › Describe or upload

## Expansion and assumptions

### Scenario

A named what-if for one program: a workforce target, a design (an additional cohort, a larger cohort, an accelerated or hybrid track, new geography, a shared regional cohort, or better retention), its dated proposed cohorts, its own assumption overrides and the saved answer. Nothing in a scenario touches the operating plan; one can be marked recommended.

- **Not the same as:** An offering is a cohort the college has committed to run; a scenario's proposed cohorts are hypothetical until someone creates offerings from them.
- **Where:** Scenarios

### Binding constraint

The first thing that runs out when a scenario's cohorts are laid over every offering already planned: faculty FTE in the peak week, preceptor-shifts at secured sites, learner seats on a date × shift × setting (physical, or only the agreements), rooms, the accreditor's capacity, the pipeline of applicants, or time (the lead times cannot land before the first start). Each one says what it is, when it first bites, by how much, and the smallest change that would relieve it.

- **Retired:** bottleneck (as a scenario verdict)
- **Where:** Scenarios

### Holiday rule

How a class, lab or clinical session that lands on an observed holiday is handled, set per college: moved to the next open day in the same week (the default), to the previous open day, or only flagged for someone to move by hand. A day the same course already uses that week is never chosen. A whole week the college is closed for (a break) is not a term week: the weeks after it slide a week later and the term ends a week later, under every rule. The imported college calendar is the only authority for which days are holidays once it exists.

- **Not the same as:** A hand-made move of one occurrence is filed under the session's pattern date and always wins over the rule.
- **Where:** Setup → Basics, the offering design page, coverage, the scheduler

### Assumption registry

Every planning figure the answers depend on — pipeline rates, lags to a productive worker, lead times, costs, supervision ratios — with its value, range, source, owner, status (default, estimate, verified) and review date. Values resolve from the most specific scope set: program → job family → college → workspace → the shipped default. A default is always shown as a default.

- **Not the same as:** A scenario override changes the figure for one scenario only and never writes to the registry.
- **Where:** Scenarios, Setup → Planning assumptions
