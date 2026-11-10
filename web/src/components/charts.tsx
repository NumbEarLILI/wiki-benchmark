import { Bar, BarChart, CartesianGrid, Legend, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AggregateMetrics } from '../types';
import { PALETTE } from '../lib';

export interface Series {
  name: string;
  metrics: AggregateMetrics;
}

const DIMS: { label: string; get: (m: AggregateMetrics) => number | undefined }[] = [
  { label: '检索综合', get: (m) => m.retrievalScore },
  { label: '命中率', get: (m) => (m.hit === undefined ? undefined : m.hit * 100) },
  { label: '排序 MRR', get: (m) => (m.mrr === undefined ? undefined : m.mrr * 100) },
  { label: '答案质量', get: (m) => m.answerScore },
  { label: '性能', get: (m) => m.performanceScore },
  { label: '成功率', get: (m) => m.successRate * 100 },
];

export function RadarCompare({ series, height = 300 }: { series: Series[]; height?: number }) {
  const data = DIMS.map((d) => {
    const row: Record<string, string | number> = { dim: d.label };
    series.forEach((s, i) => (row[`s${i}`] = Number((d.get(s.metrics) ?? 0).toFixed(1))));
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke="#e2e8f0" />
        <PolarAngleAxis dataKey="dim" tick={{ fontSize: 12, fill: '#475569' }} />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        {series.map((s, i) => (
          <Radar key={i} name={s.name} dataKey={`s${i}`} stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.12} strokeWidth={2} />
        ))}
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

export function ScoreBars({ series, height = 280 }: { series: Series[]; height?: number }) {
  const data = series.map((s) => ({
    name: s.name,
    综合: Number(s.metrics.overallScore.toFixed(1)),
    检索: Number((s.metrics.retrievalScore ?? 0).toFixed(1)),
    答案: Number((s.metrics.answerScore ?? 0).toFixed(1)),
    性能: Number(s.metrics.performanceScore.toFixed(1)),
  }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} barGap={2} margin={{ left: -16, right: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
        <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#475569' }} interval={0} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} cursor={{ fill: '#f8fafc' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="综合" fill="#4f46e5" radius={[4, 4, 0, 0]} />
        <Bar dataKey="检索" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
        <Bar dataKey="答案" fill="#10b981" radius={[4, 4, 0, 0]} />
        <Bar dataKey="性能" fill="#f59e0b" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function LatencyBars({ series, height = 240 }: { series: Series[]; height?: number }) {
  const data = series.map((s) => ({ name: s.name, P50: Math.round(s.metrics.latencyP50), P95: Math.round(s.metrics.latencyP95) }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
        <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} unit="ms" />
        <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12, fill: '#475569' }} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} cursor={{ fill: '#f8fafc' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="P50" fill="#818cf8" radius={[0, 4, 4, 0]} />
        <Bar dataKey="P95" fill="#c7d2fe" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
