import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { getAssetMap } from "@/lib/queries";
import { assetMapWorkbook } from "@/lib/assetmap";
import { prisma } from "@/lib/db";

// Download the institution's clinical asset map as the partner workbook
// (TOTALS · ASSET_MAP · 365_SHIFT_MAP · FACILITY_TOTALS) — the same layout
// partners fill in, so it round-trips through the importer.
export async function GET(req: NextRequest) {
  const institutionId = req.nextUrl.searchParams.get("institutionId") ?? (await prisma.institution.findFirst({ orderBy: { name: "asc" }, select: { id: true } }))?.id;
  if (!institutionId) return NextResponse.json({ error: "no institution" }, { status: 404 });
  const year = Number(req.nextUrl.searchParams.get("year") ?? new Date().getUTCFullYear() + 1);
  const from = req.nextUrl.searchParams.get("from") ?? `${year}-01-01`;
  const to = req.nextUrl.searchParams.get("to") ?? `${year}-12-31`;
  const employerId = req.nextUrl.searchParams.get("employerId");
  const data = await getAssetMap(institutionId, from, to);
  const assets = employerId ? data.assets.filter((a) => a.employerId === employerId) : data.assets;
  const sheets = assetMapWorkbook(assets, data.overrides, from, to);
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const fname = `Clinical_Asset_Map_${from}_${to}${employerId ? "_site" : ""}.xlsx`;
  return new NextResponse(new Blob([buf]), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${fname}"` } });
}
