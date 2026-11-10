import { useState } from 'react';
import { Trophy } from 'lucide-react';
import { api } from '../api';
import { useAsync } from '../lib';
import { Card, Empty, PageHeader, Select } from '../components/ui';
import { LeaderboardTable } from '../components/LeaderboardTable';
import { LatencyBars, RadarCompare, ScoreBars } from '../components/charts';

export default function Leaderboard() {
  const datasets = useAsync(api.datasets);
  const [datasetId, setDatasetId] = useState('');
  const board = useAsync(() => api.leaderboard(datasetId || undefined), [datasetId]);
  const rows = board.data ?? [];
  const series = rows.map((r) => ({ name: datasetId ? r.connectorName : `${r.connectorName}`, metrics: r.metrics }));

  return (
    <>
      <PageHeader
        title="排行榜"
        desc="每个知识库在每个测评集上取最近一次完成的评测结果参与排名。"
        actions={
          <Select value={datasetId} onChange={(e) => setDatasetId(e.target.value)} className="w-56">
            <option value="">全部测评集</option>
            {datasets.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        }
      />
      <Card bodyClass="p-0 px-5 py-2">
        {rows.length ? <LeaderboardTable rows={rows} /> : <Empty icon={<Trophy className="size-5" />} title="暂无排名数据" desc="完成至少一次评测任务后即可查看排名。" />}
      </Card>
      {datasetId && rows.length > 0 && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card title="分项得分"><ScoreBars series={series} /></Card>
          <Card title="能力雷达"><RadarCompare series={series.slice(0, 6)} height={280} /></Card>
          <Card title="响应延迟" className="lg:col-span-2"><LatencyBars series={series} height={Math.max(160, series.length * 48)} /></Card>
        </div>
      )}
      {!datasetId && rows.length > 0 && <p className="mt-3 text-xs text-slate-500">提示：选择单个测评集可查看分项图表对比；不同测评集的得分不具备直接可比性。</p>}
    </>
  );
}
