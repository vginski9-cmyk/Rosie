// THE COHORTS SCHEDULED TO EACH COLLEGE'S NORTH-STAR GOAL, class years 2027–2030 — as the goal page counts them: a year's
// goal run back through the family's rates (the workbook benchmarks, 0.7 completion × 0.9 licensure × 0.9 placement ×
// 0.9 productivity = 0.51) to the seats it needs, divided by the class size. Class year = the year the cohort's last
// term ends; same-day classes read "Class of N", "· 2nd class", "· 3rd class". Fall starts past a college's published
// calendar follow its fall pattern. The owner's calls (2026-11-12): two Medical Assisting classes a year at Roanoke-Chowan
// for 9 medical assistants a year; the AAS and the Diploma carry Albemarle's 56 medical-office workers a year.
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
};
