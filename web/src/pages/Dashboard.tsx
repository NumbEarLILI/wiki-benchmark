import { Link } from 'react-router-dom';
import { ArrowRight, Database, FlaskConical, Library, ListChecks, Trophy } from 'lucide-react';
import { api } from '../api';
import { useAsync, fmtTime, STATUS, type Async } from '../lib';
import type { Run } from '../types';
import { Badge, Button, Card, Empty, PageHeader, Progress } from '../components/ui';
import { LeaderboardTable } from '../components/LeaderboardTable';
import { RadarCompare } from '../components/charts';

export default function Dashboard() {
  const stats = useAsync(api.stats, [], 3000);
  const runs: Async<Run[]> = useAsync(api.runs, [], () => (runs.data?.some((r) => r.status === 'running' || r.status === 'pending') ? 1500 : 5000));
  const board = useAsync(() => api.leaderboard(), [], 5000);

  const latestDatasetId = board.data?.[0]?.datasetId;
  const topRows = (board.data ?? []).filter((r) => r.datasetId === latestDatasetId);

  const cards = [
    { label: '已接入知识库', value: stats.data?.connectors, icon: Database, to: '/connectors', color: 'from-indigo-500 to-violet-500' },
    { label: '测评集', value: stats.data?.datasets, icon: Library, to: '/datasets', color: 'from-sky-500 to-cyan-500' },
    { label: '测评题目', value: stats.data?.questions, icon: ListChecks, to: '/datasets', color: 'from-emerald-500 to-teal-500' },
    { label: '评测任务', value: stats.data?.runs, icon: FlaskConical, to: '/runs', color: 'from-amber-500 to-orange-500' },
  ];

  return (
    <>
      <PageHeader
        title="总览"
        desc="接入不同知识库服务，用统一的测评集与指标体系进行跑分对比。"
        actions={
          <Link to="/runs?new=1">
            <Button variant="primary"><FlaskConical className="size-4" />新建评测</Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} to={c.to} className="group rounded-xl bg-white p-5 ring-1 ring-slate-200/80 shadow-sm transition hover:shadow-md">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">{c.label}</span>
              <span className={`rounded-lg bg-gradient-to-br ${c.color} p-1.5 text-white`}><c.icon className="size-4" /></span>
            </div>
            <div className="mt-3 text-2xl font-semibold tabular-nums text-slate-900">{c.value ?? '—'}</div>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card
          className="lg:col-span-3"
          title={<span className="flex items-center gap-2"><Trophy className="size-4 text-amber-500" />排行榜 · {topRows[0]?.datasetName ?? '暂无数据'}</span>}
          actions={<Link to="/leaderboard" className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-500">完整榜单<ArrowRight className="size-3" /></Link>}
        >
          {topRows.length ? <LeaderboardTable rows={topRows.slice(0, 6)} compact /> : <Empty icon={<Trophy className="size-5" />} title="还没有完成的评测" desc="新建一次评测任务后，这里会显示各知识库的综合得分排名。" />}
        </Card>
        <Card className="lg:col-span-2" title="能力雷达">
          {topRows.length ? <RadarCompare series={topRows.slice(0, 5).map((r) => ({ name: r.connectorName, metrics: r.metrics }))} /> : <Empty title="暂无数据" />}
        </Card>
      </div>

      <Card className="mt-6" title="最近任务" actions={<Link to="/runs" className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-500">全部任务<ArrowRight className="size-3" /></Link>} bodyClass="p-0">
        {runs.data?.length ? (
          <ul className="divide-y divide-slate-100">
            {runs.data.slice(0, 5).map((r) => {
              const done = r.summaries.reduce((s, x) => s + x.completed, 0);
              const total = r.total * r.summaries.length;
              return (
                <li key={r.id}>
                  <Link to={`/runs/${r.id}`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50/60">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-900">{r.name}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{r.datasetName} · {r.summaries.length} 个知识库 · {fmtTime(r.createdAt)}</div>
                    </div>
                    <div className="hidden w-40 sm:block"><Progress value={total ? done / total : 0} tone={r.status === 'done' ? 'emerald' : 'indigo'} /></div>
                    <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty icon={<FlaskConical className="size-5" />} title="暂无评测任务" />
        )}
      </Card>
    </>
  );
}
