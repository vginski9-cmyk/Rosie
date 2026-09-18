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

One student counted once for each session they attend that day. Daily coverage shows distinct students (each person once) and, beside it, student-attendances: on Aug 17, 2026 the 41 radiography students in class and lab plus 19 surgical technology students are 60 students and 101 student-attendances.

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

An employer that hosts clinical shifts. Its agreement with the college is none, prospect, asked, secured or declined; a family may hold its own agreement with the site, which wins over the institution's.

- **Retired:** employer (as the noun for a hosting site)
- **Where:** Clinical sites, a site's page, the family's site setup

### Asset and setting

An asset is a room, unit or machine at a site with a setting code (GEN, ORS, ED …), the days and shift blocks it runs, and the learners it hosts per shift. A setting is the kind of clinical experience an asset provides; a program's service areas map to settings.

- **Where:** A site's assets, clinical site capacity, the scheduler

### Supply ceiling, hostable, placed

The supply ceiling is every asset-shift × learners per shift in the window — a theoretical maximum, not usable capacity. Hostable by secured sites is the part of demand that fits at sites with a secured agreement. Placed is what the scheduler actually put on an asset under its levers; seats-only placement is exploratory (nobody may be free to precept).

- **Where:** The scheduler's tiles, clinical site capacity, site load

### Requirement set, item and provision

The credentialing body's list for a family (ARRT competencies, AST case categories, CMS hours): the set, its items (each with a category, mandatory or elective, and the settings that can provide it), and a provision — whether a given site provides an item, confirmed with the site, estimated, or only inferred from its assets.

- **Where:** The clinical hub's requirements panel, a site's provision checklist, the student's requirement log

### Scope strip

The line above every capacity, coverage, staffing and scheduler view saying what the numbers are (requirements, a proposed scenario or the applied plan), whose enrollment they count, the date window, the constraints enforced, when they were computed, and why a sibling view differs.

- **Where:** Insights
