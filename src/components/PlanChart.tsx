"use client";

import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, Cell } from "recharts";

export interface PlanChartRow {
  term: string;
  clinicalDemand: number;
  wblSupply: number;
  facultyDemand: number;
  facultySupply: number;
  bottleneck: boolean;
}

/** Concurrent clinical/WBL demand (bars) vs available slots (line) across the
 *  academic-term horizon; bars turn red where demand exceeds supply. */
export function PlanChart({ data }: { data: PlanChartRow[] }) {
  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ left: 0, right: 16, top: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="term" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={56} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="clinicalDemand" name="Clinical rotations needed" radius={[3, 3, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.bottleneck ? "#ef4444" : "#34d399"} />
            ))}
          </Bar>
          <Line dataKey="wblSupply" name="Rotations hosted (live)" stroke="#0f172a" strokeWidth={2} dot={false} strokeDasharray="5 4" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
