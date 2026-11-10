import { useState } from 'react';
import { Bot, ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import type { TraceStep } from '../types';
import { ms } from '../lib';
import { cx } from './ui';

function Step({ step, index }: { step: TraceStep; index: number }) {
  const [open, setOpen] = useState(false);
  const isTool = step.type === 'tool';
  const expandable = isTool && (step.args !== undefined || step.output);
  return (
    <li className="rounded-lg bg-white ring-1 ring-slate-200">
      <button className={cx('flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs', !expandable && 'cursor-default')} onClick={() => expandable && setOpen(!open)}>
        <span className="font-mono text-slate-400">{index + 1}</span>
        {isTool ? <Wrench className="size-3.5 text-amber-500" /> : <Bot className="size-3.5 text-indigo-500" />}
        <span className="font-medium text-slate-700">{isTool ? step.name : `LLM · ${step.name}`}</span>
        {isTool && step.args !== undefined && <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-500">{JSON.stringify(step.args)}</span>}
        {!isTool && <span className="flex-1" />}
        {step.error && <span className="text-rose-600">失败</span>}
        <span className="text-slate-400 tabular-nums">{ms(step.latencyMs)}</span>
        {expandable && (open ? <ChevronDown className="size-3.5 text-slate-400" /> : <ChevronRight className="size-3.5 text-slate-400" />)}
      </button>
      {open && (
        <div className="border-t border-slate-100 px-2.5 py-2">
          {step.error && <div className="mb-1 text-xs text-rose-600">{step.error}</div>}
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-[11px] text-slate-600 scrollbar-thin">{step.output}</pre>
        </div>
      )}
    </li>
  );
}

export function TraceView({ trace }: { trace?: TraceStep[] }) {
  if (!trace?.length) return null;
  const tools = trace.filter((t) => t.type === 'tool').length;
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-slate-500">调用轨迹（{tools} 次工具调用）</div>
      <ol className="space-y-1">
        {trace.map((s, i) => <Step key={i} step={s} index={i} />)}
      </ol>
    </div>
  );
}
