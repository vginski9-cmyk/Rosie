import Link from "next/link";
import { updateFamilyAccreditation, updateSiteAccreditation } from "@/lib/actions";
import type { getAccreditorCapacity } from "@/lib/queries";
import { ACCREDITOR_CLASS_LABEL, type AccreditorClass } from "@/lib/jrcert";

// The accreditor's view of clinical capacity (JRCERT Form 1010R for radiography):
// per site, the physical resources counted from the asset map (radiographic + R&F
// rooms; mobile units + C-arms), the human resources on the site record (qualified
// radiographers during student hours), the capacity JRCERT would set — the LOWER
// of the two — against what has been approved or requested and what the calendar
// actually assigns at one time. One site at a time can be opened as a filled-in
// Form 1010R. Server component with forms.

type Report = NonNullable<Awaited<ReturnType<typeof getAccreditorCapacity>>>;
type Site = Report["sites"][number];
const STATUS_BADGE: Record<string, string> = { recognized: "bg-emerald-100 text-emerald-700", requested: "bg-amber-100 text-amber-700", none: "bg-slate-100 text-slate-500" };
const inp = "rounded border border-slate-300 px-1.5 py-0.5 text-xs";
const lbl = "block text-[9px] font-semibold uppercase tracking-wide text-slate-400";

export function AccreditorCapacity({ report, mode, openSiteId }: { report: Report; mode: "family" | "site"; openSiteId?: string | null }) {
  const fam = report.family;
  const acc = fam.accreditor ?? "JRCERT";
  const sites = report.sites;
  return (
    <div className="space-y-4">
      {mode === "family" && (
        <form action={updateFamilyAccreditation.bind(null, fam.id)} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs">
          <label className="block"><span className={lbl}>Accreditor</span><input name="accreditor" defaultValue={fam.accreditor ?? ""} placeholder="JRCERT" className={inp + " w-28"} /></label>
          <label className="block"><span className={lbl}>{acc} program number</span><input name="accreditorProgramNumber" defaultValue={fam.programNumber ?? ""} placeholder="as on the accreditor's forms" className={inp + " w-44"} /></label>
          <label className="block"><span className={lbl}>Program total clinical capacity (accredited)</span><input name="accreditedCapacity" type="number" min="0" defaultValue={fam.accreditedCapacity ?? ""} placeholder="students in clinical at one time" className={inp + " w-44"} /></label>
          <label className="block min-w-[16rem] flex-1"><span className={lbl}>Notes</span><input name="accreditationNotes" defaultValue={fam.notes ?? ""} className={inp + " w-full"} /></label>
          <button className="rounded bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-white">Save</button>
          <span className="w-full text-[11px] text-slate-500">
            Recognized settings approve <span className="font-semibold tabular-nums text-slate-800">{report.approvedTotal}</span> students at one time across {report.recognized} site{report.recognized === 1 ? "" : "s"}
            {report.requested > 0 && <> · <span className="text-amber-700">{report.requested} request{report.requested === 1 ? "" : "s"} pending ({report.requestedTotal} if approved)</span></>}
            {fam.accreditedCapacity != null && <> · accredited program total <span className="font-semibold tabular-nums">{fam.accreditedCapacity}</span>{report.approvedTotal > fam.accreditedCapacity ? <span className="text-amber-700"> — site approvals exceed the program total; a program capacity change is needed</span> : null}</>}
            {" "}· <span className="tabular-nums">{report.inClinical}</span> learners currently on clinical shifts
            {report.overCapacity > 0 && <> · <span className="font-semibold text-rose-600">⚠ {report.overCapacity} site{report.overCapacity === 1 ? "" : "s"} assigned beyond capacity</span></>}
            {report.unrecognizedInUse > 0 && <> · <span className="font-semibold text-amber-700">⚠ {report.unrecognizedInUse} site{report.unrecognizedInUse === 1 ? "" : "s"} on the calendar without {acc} recognition</span></>}
          </span>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              {mode === "family" && <th className="px-3 py-1.5 text-left">Clinical setting</th>}
              <th className="px-2 py-1.5 text-right" title="Radiographic rooms + R&F rooms">Rad + R&F rooms</th>
              <th className="px-2 py-1.5 text-right" title="Mobile units + C-arms">Mobile + C-arm</th>
              <th className="px-2 py-1.5 text-right" title="Physical resources: rooms + units">Physical</th>
              <th className="px-2 py-1.5 text-right" title="Qualified radiographers typically scheduled during the hours students are on site">Radiographers on shift</th>
              <th className="px-2 py-1.5 text-right" title="The lower of physical and human resources — what the accreditor would set">{acc} capacity</th>
              <th className="px-2 py-1.5 text-right">Approved</th>
              <th className="px-2 py-1.5 text-right" title="The most students the calendar puts on the site at one time">Assigned at once</th>
              <th className="px-2 py-1.5 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sites.map((s) => (
              <tr key={s.employerId} className={s.over > 0 ? "bg-rose-50/40" : s.peakAssigned > 0 && s.accreditorStatus !== "recognized" ? "bg-amber-50/30" : ""}>
                {mode === "family" && <td className="px-3 py-1.5"><Link href={`/employers/${s.employerId}#accreditor`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{s.name}</Link><span className="block text-[10px] text-slate-400">{[s.facilityType, s.agreementStatus !== "none" ? `agreement ${s.agreementStatus}` : null].filter(Boolean).join(" · ")}</span></td>}
                <td className="px-2 py-1.5 text-right tabular-nums">{s.rooms}<span className="block text-[10px] text-slate-400">{s.byClass.RAD_ROOM} rad · {s.byClass.RF_ROOM} R&F</span></td>
                <td className="px-2 py-1.5 text-right tabular-nums">{s.units}<span className="block text-[10px] text-slate-400">{s.byClass.MOBILE} mobile · {s.byClass.C_ARM} C-arm</span></td>
                <td className="px-2 py-1.5 text-right tabular-nums font-medium">{s.physical}{s.excluded > 0 && <span className="block text-[10px] font-normal text-slate-400">{s.excluded} not counted</span>}{s.assetsUnverified > 0 && <span className="block text-[10px] font-normal text-amber-600">{s.assetsUnverified} unverified</span>}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{s.qualifiedStaffOnShift != null ? <>{s.qualifiedStaffOnShift}<span className="block text-[10px] text-slate-400">{s.staffCountSource.toLowerCase()}{s.studentHoursWindow ? ` · ${s.studentHoursWindow}` : ""}</span></> : <><span className="text-amber-700">~{s.humanEstimate}</span><span className="block text-[10px] text-amber-600">estimate — count them</span></>}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{s.capacity}<span className="block text-[10px] font-normal text-slate-400">{s.limiting === "human" ? "limited by staff" : s.limiting === "physical" ? "limited by rooms / units" : "rooms = staff"}</span></td>
                <td className="px-2 py-1.5 text-right tabular-nums">{s.approvedCapacity ?? <span className="text-slate-300">—</span>}{s.requestedCapacity != null && s.requestedCapacity !== s.approvedCapacity && <span className="block text-[10px] text-amber-700">{s.requestedCapacity} requested</span>}{s.approvedCapacity != null && s.approvedCapacity > s.capacity && <span className="block text-[10px] text-rose-600">above today's resources</span>}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums ${s.over > 0 ? "font-semibold text-rose-600" : s.peakAssigned > 0 ? "text-slate-800" : "text-slate-300"}`}>{s.peakAssigned || "—"}{s.peakDay && <span className="block text-[10px] font-normal text-slate-400">{s.peakDay} {s.peakStart}{s.cohorts.length ? ` · ${s.cohorts.join(", ")}` : ""}</span>}{s.over > 0 && <span className="block text-[10px]">⚠ {s.over} over</span>}</td>
                <td className="px-2 py-1.5"><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[s.accreditorStatus]}`}>{s.accreditorStatus === "none" ? "not recognized" : s.accreditorStatus}</span>{s.capacityUpdatedAt && <span className="block text-[10px] text-slate-400">updated {s.capacityUpdatedAt}</span>}</td>
              </tr>
            ))}
            {sites.length === 0 && <tr><td colSpan={9} className="px-3 py-4 text-center text-slate-400">No sites carry imaging assets for this family yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400">Counted the way Form 1010R asks: radiographic + R&F rooms, and mobile + C-arm units, on the facility&apos;s own campus — mammography, CT, MR, ultrasound, nuclear medicine, interventional, cardiovascular, bone densitometry and therapy equipment are excluded. Each asset&apos;s class is derived from its setting and type; override it on the asset card. Capacity is the lower of the physical count and the radiographers on shift during student hours.</p>

      {mode === "site" && sites.map((s) => <SiteForm key={s.employerId} fam={fam} s={s} accreditedCapacity={fam.accreditedCapacity} />)}
      {mode === "family" && openSiteId && sites.filter((s) => s.employerId === openSiteId).map((s) => <SiteForm key={s.employerId} fam={fam} s={s} accreditedCapacity={fam.accreditedCapacity} />)}
    </div>
  );
}

function SiteForm({ fam, s, accreditedCapacity }: { fam: Report["family"]; s: Site; accreditedCapacity: number | null }) {
  const acc = fam.accreditor ?? "JRCERT";
  const counted = s.assets.filter((a) => a.accreditorClass !== "EXCLUDED");
  const excluded = s.assets.filter((a) => a.accreditorClass === "EXCLUDED");
  const requested = s.requestedCapacity ?? s.approvedCapacity ?? s.capacity;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form action={updateSiteAccreditation.bind(null, fam.id, s.employerId)} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-xs">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{acc} recognition of this setting — {fam.name}</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <label className="block"><span className={lbl}>Status</span><select name="accreditorStatus" defaultValue={s.accreditorStatus} className={inp + " w-full"}><option value="none">not recognized</option><option value="requested">requested</option><option value="recognized">recognized</option></select></label>
          <label className="block"><span className={lbl}>Approved capacity</span><input name="approvedCapacity" type="number" min="0" defaultValue={s.approvedCapacity ?? ""} className={inp + " w-full"} /></label>
          <label className="block"><span className={lbl}>Requested capacity</span><input name="requestedCapacity" type="number" min="0" defaultValue={s.requestedCapacity ?? ""} placeholder={String(s.capacity)} className={inp + " w-full"} /></label>
          <label className="block"><span className={lbl}>Radiographers on shift</span><input name="qualifiedStaffOnShift" type="number" min="0" defaultValue={s.qualifiedStaffOnShift ?? ""} placeholder={`~${s.humanEstimate}`} className={inp + " w-full"} /></label>
          <label className="block"><span className={lbl}>Count source</span><select name="staffCountSource" defaultValue={s.staffCountSource} className={inp + " w-full"}>{["VERIFIED", "ESTIMATE", "GAP"].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          <label className="block"><span className={lbl}>Student hours on site</span><input name="studentHoursWindow" defaultValue={s.studentHoursWindow ?? ""} placeholder="07:00–15:30" className={inp + " w-full"} /></label>
        </div>
        <label className="block"><span className={lbl}>Notes (form date, who signed, conditions)</span><input name="accreditorNotes" defaultValue={s.accreditorNotes ?? ""} className={inp + " w-full"} /></label>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-500">Today&apos;s resources support <span className="font-semibold tabular-nums text-slate-800">{s.capacity}</span> at once ({s.physical} physical · {s.qualifiedStaffOnShift ?? `~${s.humanEstimate}`} radiographers); the calendar assigns up to <span className={`font-semibold tabular-nums ${s.over > 0 ? "text-rose-600" : "text-slate-800"}`}>{s.peakAssigned}</span>.</span>
          <button className="rounded bg-rose-600 px-2.5 py-1 text-[11px] font-medium text-white">Save</button>
        </div>
      </form>

      {/* Form 1010R, filled from the record */}
      <div className="rounded-lg border border-slate-300 bg-white p-4 text-xs print:border-0" id="form-1010r">
        <div className="flex items-start justify-between gap-2">
          <div><div className="text-sm font-semibold text-slate-900">Form 1010R — Clinical Capacity Change, Radiography</div><div className="text-[10px] text-slate-500">Filled from this record · JRCERT, 20 N. Wacker Drive, Suite 2850, Chicago, IL 60606 · revised 01/2022</div></div>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">prefill</span>
        </div>
        <div className="mt-3 space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">I. General information</div>
          <Row k="Program name" v={`${fam.institution} — ${fam.programNames[0] ?? fam.name}`} />
          <Row k="JRCERT program number" v={fam.programNumber ?? ""} missing={!fam.programNumber} />
          <Row k="Clinical setting for which capacity change is sought" v={s.name + (s.organization ? ` (${s.organization})` : "")} />
          <Row k="Clinical setting address" v={s.address} missing={!s.address} />
          <div className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">II. Clinical capacity</div>
          <Row k="Total number of radiographic plus R&F rooms" v={String(s.rooms)} />
          <Row k="Total number of mobile and C-arm units" v={String(s.units)} />
          <Row k="Total number of qualified practitioners / radiographers typically scheduled during the time of day students will be on site" v={s.qualifiedStaffOnShift != null ? `${s.qualifiedStaffOnShift}${s.studentHoursWindow ? ` (students on site ${s.studentHoursWindow})` : ""}` : `~${s.humanEstimate} (estimate — confirm with the site)`} missing={s.qualifiedStaffOnShift == null} />
          <Row k="New requested clinical capacity (students assigned to the facility at any one time)" v={String(requested)} note={requested > s.capacity ? `above the ${s.capacity} the lower resource supports` : undefined} />
          <div className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">III. Program total capacity</div>
          <Row k="Based on this change, the program total capacity would" v={s.change.kind === "same" ? "☑ Remain the same" : s.change.kind === "increase" ? `☑ Increase by ${s.change.by} student${s.change.by === 1 ? "" : "s"}${s.change.newTotal != null ? ` (to ${s.change.newTotal})` : ""}` : `☑ Decrease by ${s.change.by} student${s.change.by === 1 ? "" : "s"}${s.change.newTotal != null ? ` (to ${s.change.newTotal})` : ""}`} note={accreditedCapacity == null ? "enter the accredited program total on the family's clinical page" : undefined} />
          <div className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">IV. Signature</div>
          <Row k="Program Director" v="" missing />
        </div>
        <details className="mt-3 text-[11px]">
          <summary className="cursor-pointer text-slate-500">Assets behind the counts — {counted.length} counted, {excluded.length} excluded</summary>
          <ul className="mt-1 columns-2 gap-4">
            {s.assets.map((a) => <li key={a.id} className={a.accreditorClass === "EXCLUDED" ? "text-slate-400" : "text-slate-700"}>{a.externalId ?? `${a.settingCode}-${a.assetNumber}`} · {a.assetType} → {ACCREDITOR_CLASS_LABEL[a.accreditorClass as AccreditorClass]}{a.coded ? " (coded)" : ""}{a.dataSource !== "VERIFIED" ? <span className="text-amber-600"> · {a.dataSource.toLowerCase()}</span> : null}</li>)}
          </ul>
        </details>
      </div>
    </div>
  );
}

function Row({ k, v, missing, note }: { k: string; v: string; missing?: boolean; note?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-2 border-b border-dotted border-slate-200 py-0.5">
      <span className="text-slate-500">{k}</span>
      <span className={`font-medium ${missing ? "text-amber-600" : "text-slate-900"}`}>{v || "— fill in —"}{note && <span className="block text-[10px] font-normal text-amber-600">{note}</span>}</span>
    </div>
  );
}
