import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { getRotationExport } from "@/lib/queries";
import { rotationSheets, sheetToCsv } from "@/lib/rotationexport";

export const runtime = "nodejs";

// Download an offering's clinical rotation schedule — every course, or one course (?course=) —
// as a workbook (rotation log · week by week · site load) or, with ?format=csv, the log alone.
export async function GET(req: NextRequest, { params }: { params: { cohortId: string } }) {
  const courseId = req.nextUrl.searchParams.get("course");
  const format = req.nextUrl.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const data = await getRotationExport(params.cohortId, courseId);
  if (!data) return NextResponse.json({ error: "offering not found" }, { status: 404 });
  const sheets = rotationSheets(data.rows);
  const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const base = `Clinical_rotations_${safe(data.cohort.program)}_${safe(data.cohort.name)}${data.course ? `_${safe(data.course.code ?? data.course.name)}` : ""}`;
  if (format === "csv") {
    return new NextResponse(sheetToCsv(sheets["Rotation log"]), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${base}.csv"` } });
  }
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new NextResponse(new Blob([buf]), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${base}.xlsx"` } });
}
