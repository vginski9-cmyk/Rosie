// THE ORDER SESSIONS ARE SHOWN IN, everywhere: by the week they run in, then the day of the week,
// then the start time, then kind (class, lab, clinical), then the sheet's own number. A session
// list is a timetable, so a mis-numbered row (Roanoke-Chowan's workbook numbered two week-10
// classes 18 and 19) can never land it among week 6 and 7. Queries pre-sort by week and number
// (Prisma cannot order by day names); components finish with `compareSessions`.

export const SESSION_ORDER_BY = [{ week: "asc" as const }, { number: "asc" as const }];
const DAY: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6, Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4, Saturday: 5, Sunday: 6 };
const KIND: Record<string, number> = { CLASS: 0, LAB: 1, CLINICAL: 2 };

export interface OrderableSession { week?: number | null; dayOfWeek?: string | null; startTime?: string | null; kind: string; number: number }

export function compareSessions(a: OrderableSession, b: OrderableSession): number {
  const wa = a.week ?? Number.MAX_SAFE_INTEGER, wb = b.week ?? Number.MAX_SAFE_INTEGER;
  if (wa !== wb) return wa - wb;
  const da = a.dayOfWeek != null ? DAY[a.dayOfWeek] ?? 8 : 8, db = b.dayOfWeek != null ? DAY[b.dayOfWeek] ?? 8 : 8;
  if (da !== db) return da - db;
  const ta = a.startTime ?? "99:99", tb = b.startTime ?? "99:99";
  if (ta !== tb) return ta.localeCompare(tb);
  const ka = KIND[a.kind] ?? 9, kb = KIND[b.kind] ?? 9;
  if (ka !== kb) return ka - kb;
  return a.number - b.number;
}
