// THE COHORTS SCHEDULED TO EACH COLLEGE'S NORTH-STAR GOAL, class years 2027–2030 — as the goal page counts them: a year's
// goal run back through the family's rates (the workbook benchmarks, 0.7 completion × 0.9 licensure × 0.9 placement ×
// 0.9 productivity = 0.51) to the seats it needs, divided by the class size. Class year = the year the cohort's last
// term ends; same-day classes read "Class of N", "· 2nd class", "· 3rd class". Fall starts past a college's published
// calendar follow its fall pattern. The owner's calls (2026-11-12): two Medical Assisting classes a year at Roanoke-Chowan
// for 9 medical assistants a year; the AAS and the Diploma carry Albemarle's 56 medical-office workers a year. And (2026-11-18):
// "schedule out all of 2026 through 2030" for the Nurse Aide families at Carteret (55 a year) and Craven (50, 50, 55, 60, 60)
// — so every year 2026–2030 is covered by the model's count (a short class counts toward the year it starts, the year in its
// name, as the goal page reads it; every class below starts and ends in the same year); 2026 classes already run or running
// are the model's, not the college's record, and say so in the audit. Lenoir's are in seed-lenoir.ts, on its own slots.
import type { OfferingSpec } from "./seed-roster";

const times = (n: number, spec: OfferingSpec): OfferingSpec[] => Array.from({ length: n }, () => ({ ...spec }));

export const SCHEDULED_OFFERINGS: Record<string, OfferingSpec[]> = {
  // 9 a year needs about 18 seats at the family's rates → two classes of the college's 10 seats (5.1 productive each, 10.2 a year):
  // Part 1 from the fall semester's first day, Part 2 in the spring — class of 2027 through class of 2030.
  "Roanoke-Chowan Community College": [
    ...times(2, { program: "Medical Assisting", start: "2026-08-17", goal: 4.5, seats: 10, counts: { enrolled: 10 } }),
    ...times(2, { program: "Medical Assisting", start: "2027-08-16", goal: 4.5, seats: 10, counts: { enrolled: 10 } }),
    ...times(2, { program: "Medical Assisting", start: "2028-08-21", goal: 4.5, seats: 10, counts: { enrolled: 10 } }),
    ...times(2, { program: "Medical Assisting", start: "2029-08-20", goal: 4.5, seats: 10, counts: { enrolled: 10 } }),
  ],
  // 56 a year needs about 110 seats; the AAS and the Diploma carry 28 each → about 55 seats each → three classes of 19 of each
  // credential a year (the AAS's 20-seat cap holds; 9.7 productive each, 58.2 a year). The two-year AAS's class of 2027 began in
  // fall 2025; the Diploma (fall, spring, the 10-week summer) finishes the summer after its fall start.
  "College of The Albemarle": [
    ...times(3, { program: "Medical Office Administration AAS (A25310MO, hybrid)", start: "2025-08-18", goal: 9.33, counts: { enrolled: 19 } }),
    ...times(3, { program: "Medical Office Administration AAS (A25310MO, hybrid)", start: "2026-08-17", goal: 9.33, counts: { enrolled: 19 } }),
    ...times(3, { program: "Medical Office Administration AAS (A25310MO, hybrid)", start: "2027-08-16", goal: 9.33, counts: { enrolled: 19 } }),
    ...times(3, { program: "Medical Office Administration AAS (A25310MO, hybrid)", start: "2028-08-14", goal: 9.33, counts: { enrolled: 19 } }),
    ...times(3, { program: "Medical Office Administration Diploma (D25310MO)", start: "2026-08-17", goal: 9.33, counts: { enrolled: 19 } }),
    ...times(3, { program: "Medical Office Administration Diploma (D25310MO)", start: "2027-08-16", goal: 9.33, counts: { enrolled: 19 } }),
    ...times(3, { program: "Medical Office Administration Diploma (D25310MO)", start: "2028-08-14", goal: 9.33, counts: { enrolled: 19 } }),
    ...times(3, { program: "Medical Office Administration Diploma (D25310MO)", start: "2029-08-20", goal: 9.33, counts: { enrolled: 19 } }),
  ],
  // Carteret: 55 a year needs about 108 seats at the family's rates → eleven classes of the workbook's ten seats a class year
  // (5.1 productive each, 56.1 a year) on the college's six delivery models in a yearly pattern — 6-week in January, March and
  // August (the fall semester's first Monday), 5-week in February, May and October, the Fri/Sat 11-week daytime class in March and
  // August, the 11-week nighttime and the 14-week high-school pre-apprenticeship in January, the 8-week summer evening class in
  // June. The six classes on record since 2026-10 (2026-08-17 6-week, 2026-10-05 5-week, 2026-08-21 11-week daytime, 2027-01-11
  // nighttime and high school, 2027-06-01 summer) keep their dates; every class starts and ends within its year (the 5-week
  // model runs six weeks). Rooms are the college's to enter.
  "Carteret Community College": [
    // 2026's March 6-week class and the high-school class are placed clear of the college's Easter and spring-break week
    // (April 6–10, 2026), which the holiday rule cannot move clinical days across: the 6-week class starts April 13 and the
    // high-school class runs in the fall (August 17), so each of the year's eleven classes is a class that could have run.
    ...carteretYear(2026, { six: ["2026-01-12", "2026-04-13", "2026-08-17"], five: ["2026-02-16", "2026-05-11", "2026-10-05"], day11: ["2026-03-13", "2026-08-21"], night11: "2026-01-12", hs: "2026-08-17", summer: "2026-06-01" }),
    ...carteretYear(2027, { six: ["2027-01-11", "2027-03-01", "2027-08-16"], five: ["2027-02-15", "2027-05-10", "2027-10-04"], day11: ["2027-03-12", "2027-08-20"], night11: "2027-01-11", hs: "2027-01-11", summer: "2027-06-01" }),
    ...carteretYear(2028, { six: ["2028-01-10", "2028-03-06", "2028-08-21"], five: ["2028-02-21", "2028-05-08", "2028-10-02"], day11: ["2028-03-10", "2028-08-18"], night11: "2028-01-10", hs: "2028-01-10", summer: "2028-06-05" }),
    ...carteretYear(2029, { six: ["2029-01-08", "2029-03-05", "2029-08-20"], five: ["2029-02-19", "2029-05-14", "2029-10-01"], day11: ["2029-03-09", "2029-08-17"], night11: "2029-01-08", hs: "2029-01-08", summer: "2029-06-04" }),
    ...carteretYear(2030, { six: ["2030-01-14", "2030-03-04", "2030-08-19"], five: ["2030-02-18", "2030-05-13", "2030-10-07"], day11: ["2030-03-08", "2030-08-16"], night11: "2030-01-14", hs: "2030-01-14", summer: "2030-06-03" }),
  ],
  // Craven: 50, 50, 55, 60 and 60 a year (the family's goal stair). A 16-seat class yields 8.2, the 10-seat CCP class 5.1: the
  // workbook's five models once each a year — the 16-week day and night classes in the spring and the fall, the 13-week summer
  // day and night classes, the high-school CCP class each fall — make seven classes (54.1) for 2026 and 2027; a second spring
  // day class makes eight (62.3) for 2028–2030. Starts on the Monday of the college's term starts (the 2026–27 calendar: fall
  // Aug 19, spring Jan 11, summer May 20), then the same pattern. Rooms are the college's to enter.
  "Craven Community College": [
    ...cravenYear({ spring: "2026-01-12", summer: "2026-05-18", fall: "2026-08-17" }),
    ...cravenYear({ spring: "2027-01-11", summer: "2027-05-17", fall: "2027-08-16" }),
    ...cravenYear({ spring: "2028-01-10", summer: "2028-05-15", fall: "2028-08-21" }, true),
    ...cravenYear({ spring: "2029-01-08", summer: "2029-05-14", fall: "2029-08-20" }, true),
    ...cravenYear({ spring: "2030-01-14", summer: "2030-05-13", fall: "2030-08-19" }, true),
  ],
};

/** Carteret's eleven classes of a class year on its six models: ten seats each, the model's 5.1 productive. */
function carteretYear(_year: number, d: { six: string[]; five: string[]; day11: string[]; night11: string; hs: string; summer: string }): OfferingSpec[] {
  const ten = (program: string, start: string): OfferingSpec => ({ program, start, goal: 5.1, seats: 10, counts: { enrolled: 10 } });
  return [
    ...d.six.map((s) => ten("Nurse Aide Level I — 6-week offering", s)),
    ...d.five.map((s) => ten("Nurse Aide Level I — 5-week offering", s)),
    ...d.day11.map((s) => ten("Nurse Aide Level I — 11-week daytime offering", s)),
    ten("Nurse Aide Level I — 11-week nighttime offering", d.night11),
    ten("Nurse Aide Level I — 14-week high school offering", d.hs),
    ten("Nurse Aide Level I — 8-week summer offering", d.summer),
  ];
}
/** Craven's seven (or eight) classes of a class year on its five models: sixteen seats (8.2 productive), the CCP class ten (5.1). */
function cravenYear(d: { spring: string; summer: string; fall: string }, secondSpringDay = false): OfferingSpec[] {
  const sixteen = (program: string, start: string): OfferingSpec => ({ program, start, goal: 8.17, counts: { enrolled: 16 } });
  return [
    sixteen("Nurse Aide Level I — 16-week (DAY)", d.spring), sixteen("Nurse Aide Level I — 16-week (NIGHT)", d.spring),
    ...(secondSpringDay ? [sixteen("Nurse Aide Level I — 16-week (DAY)", d.spring)] : []),
    sixteen("Nurse Aide Level I — 13-week Summer (DAY)", d.summer), sixteen("Nurse Aide Level I — 13-week Summer (NIGHT)", d.summer),
    sixteen("Nurse Aide Level I — 16-week (DAY)", d.fall), sixteen("Nurse Aide Level I — 16-week (NIGHT)", d.fall),
    { program: "Nurse Aide Level I — 16-week (CCP)", start: d.fall, goal: 5.1, counts: { enrolled: 10 } },
  ];
}
