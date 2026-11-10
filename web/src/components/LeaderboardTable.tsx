import { Link } from 'react-router-dom';
import { Medal } from 'lucide-react';
import type { LeaderboardEntry } from '../types';
import { fmtTime, ms, pct, score, scoreTone } from '../lib';
import { Badge, cx } from './ui';

const medal = ['text-amber-400', 'text-slate-400', 'text-orange-700'];

export function LeaderboardTable({ rows, compact }: { rows: LeaderboardEntry[]; compact?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
            <th className="py-2.5 pr-3 pl-1 w-12">排名</th>
            <th className="py-2.5 pr-3">知识库</th>
            {!compact && <th className="py-2.5 pr-3">测评集</th>}
            <th className="py-2.5 pr-3 text-right">综合得分</th>
            <th className="py-2.5 pr-3 text-right">检索</th>
            <th className="py-2.5 pr-3 text-right">答案</th>
            <th className="py-2.5 pr-3 text-right">性能</th>
            {!compact && <th className="py-2.5 pr-3 text-right">Hit@K</th>}
            {!compact && <th className="py-2.5 pr-3 text-right">MRR</th>}
            <th className="py-2.5 pr-3 text-right">P50 延迟</th>
            {!compact && <th className="py-2.5 pr-3 text-right">成功率</th>}
            {!compact && <th className="py-2.5 pr-1 text-right">评测时间</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.datasetId}-${r.connectorId}`} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
              <td className="py-3 pr-3 pl-1">
                {i < 3 ? <Medal className={cx('size-5', medal[i])} /> : <span className="pl-1 text-slate-400">{i + 1}</span>}
              </td>
              <td className="py-3 pr-3">
                <Link to={`/runs/${r.runId}`} className="font-medium text-slate-900 hover:text-indigo-600">{r.connectorName}</Link>
                <div className="mt-0.5"><Badge>{r.connectorType}</Badge></div>
              </td>
              {!compact && <td className="py-3 pr-3 text-slate-600">{r.datasetName}</td>}
              <td className={cx('py-3 pr-3 text-right text-base font-semibold tabular-nums', scoreTone(r.metrics.overallScore))}>{score(r.metrics.overallScore)}</td>
              <td className="py-3 pr-3 text-right tabular-nums">{score(r.metrics.retrievalScore)}</td>
              <td className="py-3 pr-3 text-right tabular-nums">{score(r.metrics.answerScore)}</td>
              <td className="py-3 pr-3 text-right tabular-nums">{score(r.metrics.performanceScore)}</td>
              {!compact && <td className="py-3 pr-3 text-right tabular-nums">{pct(r.metrics.hit)}</td>}
              {!compact && <td className="py-3 pr-3 text-right tabular-nums">{r.metrics.mrr?.toFixed(3) ?? '—'}</td>}
              <td className="py-3 pr-3 text-right tabular-nums text-slate-600">{ms(r.metrics.latencyP50)}</td>
              {!compact && <td className="py-3 pr-3 text-right tabular-nums">{pct(r.metrics.successRate, 0)}</td>}
              {!compact && <td className="py-3 pr-1 text-right text-xs text-slate-500">{fmtTime(r.runAt)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
