import Link from "next/link";
import { notFound } from "next/navigation";
import { getFamilySupply, getFamilyClinicalSetup, getFamilyClinicalHoursBridge } from "@/lib/queries";
import { dec } from "@/lib/format";
import { RequirementsPanel } from "@/components/RequirementsPanel";
import { FamilySitesTable } from "@/components/FamilySitesTable";
import { SupplyMapBoard } from "@/components/SupplyMapBoard";
import { Collapse } from "@/components/Collapse";
import { CoverageHeadline } from "@/components/Evidence";

// ONE PROGRAM'S CLINICAL NETWORK, on one page, in the order the work happens:
// what completion requires (scored against the sites), the sites themselves (each
// opening its own setup), and — folded away — the raw asset map. The scheduling rules
// and the accreditor's capacity picture are read on the org and site pages (hidden here, 2026-09-29). Server component; `base` is the URL the
// site pages hang off.

export async function FamilyClinicalHub({ familyId, base }: { familyId: string; base: string }) {
  const setup = await getFamilyClinicalSetup(familyId);
  if (!setup) notFound();
  const [data, bridge] = await Promise.all([getFamilySupply(familyId), getFamilyClinicalHoursBridge(familyId)]);
  const hoursGap = bridge.programs.filter((p) => p.unmapped.length > 0);
  const year = new Date().getUTCFullYear() + 1;
  const fam = setup.family;
  const req = setup.req;
  const score = req?.sets.reduce((a, s) => ({ requiredCovered: a.requiredCovered + s.score.requiredCovered, requiredConfirmed: a.requiredConfirmed + s.score.requiredConfirmed, required: a.required + s.score.required, unverified: a.unverified + s.score.unverified }), { requiredCovered: 0, requiredConfirmed: 0, required: 0, unverified: 0 }) ?? null;
  const unverifiedStandard = !!req?.sets.some((s) => !s.verified);
  const siteHref = (id: string) => `${base}/sites/${id}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 text-xs">
        <a href="#sites" className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700 hover:bg-slate-200"><strong>{setup.totals.sites}</strong> sites · <strong className="text-emerald-700">{setup.totals.secured}</strong> secured · <strong className="text-amber-700">{setup.totals.asked}</strong> asked · {setup.totals.seatsSecured} secured seats per shift</a>
        {score && score.required > 0 && <CoverageHeadline score={score} href="#requirements" unverifiedStandard={unverifiedStandard} />}
        <Link href="/insights/site-load" className="rounded-full bg-white px-2.5 py-1 text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50">which sites carry the load →</Link>
      </div>
      {hoursGap.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-2.5 text-xs text-amber-900">
          <span className="font-semibold">Clinical hours, two ways.</span> {hoursGap.map((p) => <span key={p.programId}>{p.program}: the session table gives <strong>{dec(p.sessionHours)} h</strong> per student, the hours coded by setting add up to <strong>{dec(p.codedHours)} h</strong> — {p.unmapped.map((u) => `${u.course} ${dec(u.sessionHours)} h in sessions vs ${dec(u.codedHours)} h coded (${dec(Math.abs(u.sessionHours - u.codedHours))} h ${u.sessionHours > u.codedHours ? "not assigned to any setting" : "coded beyond the sessions"})`).join("; ")}. </span>)}
          The requirement roll-up and the by-setting grid read the coded hours; the design pages read the session table. Fix the coding on the course, not the number.
        </div>
      )}

      <section id="requirements" className="scroll-mt-16 space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">1 · What completion requires <span className="text-sm font-normal text-slate-400">— {req?.sets.map((x) => x.authority.split(" · ")[0]).join(" · ") || "no requirement set yet"}, and which site provides each experience</span></h2>
        {req && req.sets.length > 0 ? <RequirementsPanel req={req} siteHref={siteHref} /> : <p className="text-sm text-amber-700">No requirement set is loaded for {fam.name}. Enter the credentialing body&apos;s list to score the network against it.</p>}
      </section>

      <section id="sites" className="scroll-mt-16 space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">2 · Sites <span className="text-sm font-normal text-slate-400">— open one to set its agreement, assets and shifts, staff, availability and what it provides</span></h2>
        <FamilySitesTable setup={setup} siteHref={siteHref} />
      </section>

      {data && (
        <div id="assets" className="scroll-mt-16">
          <Collapse title="3 · Every asset in the network" sub="The whole asset map for this program: totals by setting, county and ring, workbook import and export" summary={<>{data.sites.length} sites · {data.sites.reduce((n, s) => n + s.assets.length, 0)} assets</>}>
            <SupplyMapBoard family={data.family} settings={data.settings} sites={data.sites} overrides={data.overrides} organizations={data.organizations} year={year} />
          </Collapse>
        </div>
      )}
    </div>
  );
}
