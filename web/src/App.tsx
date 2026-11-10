import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { Database, FlaskConical, Gauge, Library, Settings as SettingsIcon, Trophy } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Connectors from './pages/Connectors';
import Datasets from './pages/Datasets';
import DatasetDetail from './pages/DatasetDetail';
import Runs from './pages/Runs';
import RunDetail from './pages/RunDetail';
import Leaderboard from './pages/Leaderboard';
import SettingsPage from './pages/Settings';
import { cx } from './components/ui';

const nav = [
  { to: '/', label: '总览', icon: Gauge, end: true },
  { to: '/leaderboard', label: '排行榜', icon: Trophy },
  { to: '/runs', label: '评测任务', icon: FlaskConical },
  { to: '/connectors', label: '知识库接入', icon: Database },
  { to: '/datasets', label: '测评集', icon: Library },
  { to: '/settings', label: '评分设置', icon: SettingsIcon },
];

export default function App() {
  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex h-16 items-center gap-2.5 px-5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30">
            <Trophy className="size-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">KB Bench</div>
            <div className="text-[11px] text-slate-500">知识库测评平台</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3 py-2">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition',
                  isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                )
              }
            >
              <n.icon className="size-4" />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="m-3 rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
          支持 Dify、RAGFlow、FastGPT、OpenAI 兼容接口与自定义 HTTP 服务。
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 md:hidden">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium', isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600')}>
              {n.label}
            </NavLink>
          ))}
        </header>
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/leaderboard" element={<Leaderboard />} />
              <Route path="/runs" element={<Runs />} />
              <Route path="/runs/:id" element={<RunDetail />} />
              <Route path="/connectors" element={<Connectors />} />
              <Route path="/datasets" element={<Datasets />} />
              <Route path="/datasets/:id" element={<DatasetDetail />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}
