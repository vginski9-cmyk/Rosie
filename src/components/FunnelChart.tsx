"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from "recharts";
import { analyzeFunnel, type StageKey } from "@/lib/funnel";
import { fmt } from "@/lib/format";

export interface FunnelStageInput {
  key: StageKey;
  label: string;
  target?: number | null;
  actual?: number | null;
}

export function FunnelChart({ stages }: { stages: FunnelStageInput[] }) {
  const analysis = analyzeFunnel(stages);
  const data = analysis.map((a) => ({
    name: a.label,
    target: a.target ?? 0,
    actual: a.actual ?? 0,
    color: a.color,
    conv: a.targetConversion,
  }));

  return (
    <div className="space-y-4">
      <div className="h-[420px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 32, top: 8, bottom: 8 }} barGap={2}>
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 11 }} />
            <Tooltip
              formatter={(v: number, n: string) => [fmt.num(v, 1), n === "target" ? "Target" : "Actual"]}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Bar dataKey="target" name="target" radius={[0, 4, 4, 0]} fillOpacity={0.25}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
              <LabelList dataKey="target" position="right" formatter={(v: number) => fmt.num(v)} style={{ fontSize: 10, fill: "#94a3b8" }} />
            </Bar>
            <Bar dataKey="actual" name="actual" radius={[0, 4, 4, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
              <LabelList dataKey="actual" position="right" formatter={(v: number) => (v ? fmt.num(v) : "")} style={{ fontSize: 10, fill: "#475569" }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Stage</th>
              <th className="th text-right">Target</th>
              <th className="th text-right">Actual</th>
              <th className="th text-right">Plan conv.</th>
              <th className="th text-right">Actual conv.</th>
              <th className="th text-right">Attainment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {analysis.map((a) => (
              <tr key={a.key}>
                <td className="td font-medium">{a.label}</td>
                <td className="td text-right">{fmt.num(a.target, 0)}</td>
                <td className="td text-right">{fmt.num(a.actual, 0)}</td>
                <td className="td text-right text-slate-400">{a.targetConversion != null ? fmt.pct(a.targetConversion) : "—"}</td>
                <td className="td text-right">
                  {a.actualConversion != null ? (
                    <span className={a.targetConversion != null && a.actualConversion < a.targetConversion ? "text-rose-600" : "text-emerald-600"}>
                      {fmt.pct(a.actualConversion)}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="td text-right">
                  {a.attainment != null ? (
                    <span className={a.attainment < 1 ? "text-rose-600" : "text-emerald-600"}>{fmt.pct(a.attainment)}</span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
