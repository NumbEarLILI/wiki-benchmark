import { useEffect, useState } from 'react';
import { ArrowUp, FileText, Folder, FolderOpen, HardDrive, Puzzle } from 'lucide-react';
import { api } from '../api';
import type { BrowseResult } from '../types';
import { Badge, Button, ErrorBox, Input, Modal, cx } from './ui';

/** 浏览服务端文件系统选择目录（或文件），路径为服务端本地路径 */
export function PathPicker({ open, onClose, initial, mode = 'dir', onPick }: { open: boolean; onClose: () => void; initial?: string; mode?: 'dir' | 'file'; onPick: (path: string) => void }) {
  const [data, setData] = useState<BrowseResult>();
  const [input, setInput] = useState('');
  const [file, setFile] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const go = async (p?: string) => {
    setLoading(true);
    setError(undefined);
    try {
      const r = await api.browse(p, mode === 'file');
      setData(r);
      setInput(r.path);
      setFile(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) go(initial || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (p: string) => {
    onPick(p);
    onClose();
  };
  const chosen = mode === 'file' ? file : data?.path;

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={mode === 'file' ? '选择文件' : '选择目录'}
      footer={
        <>
          <span className="mr-auto self-center truncate font-mono text-xs text-slate-500" title={chosen}>{chosen ?? '请选择一个文件'}</span>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={!chosen} onClick={() => chosen && pick(chosen)}>{mode === 'file' ? '选择该文件' : '选择当前目录'}</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
        <div className="space-y-4 text-xs">
          {!!data?.shortcuts.length && (
            <div>
              <div className="mb-1.5 font-medium text-slate-500">常用位置</div>
              {data.shortcuts.map((s) => (
                <button key={`${s.label}${s.path}`} title={s.path} onClick={() => go(s.path)} className={cx('block w-full truncate rounded-md px-2 py-1.5 text-left hover:bg-slate-100', data.path === s.path ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700')}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
          {!!data?.roots.length && (
            <div>
              <div className="mb-1.5 font-medium text-slate-500">磁盘</div>
              {data.roots.map((r) => (
                <button key={r} onClick={() => go(r)} className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left font-mono text-slate-700 hover:bg-slate-100">
                  <HardDrive className="size-3.5 text-slate-400" />{r}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), go(input))}>
            <Button type="button" size="sm" disabled={!data?.parent || loading} onClick={() => data?.parent && go(data.parent)} title="上一级"><ArrowUp className="size-3.5" /></Button>
            <Input value={input} onChange={(e) => setInput(e.target.value)} className="font-mono text-xs" placeholder="输入路径后回车跳转" />
          </form>
          {data?.skill && mode === 'dir' && <div className="mt-2 text-xs text-emerald-700"><Puzzle className="mr-1 inline size-3.5" />当前目录包含 SKILL.md，是一个技能目录</div>}
          {(error || data?.error) && <div className="mt-2"><ErrorBox>{error || data?.error}</ErrorBox></div>}
          <div className={cx('mt-2 h-80 overflow-y-auto rounded-lg ring-1 ring-slate-200 scrollbar-thin', loading && 'opacity-60')}>
            {data?.entries.length === 0 && <div className="p-6 text-center text-xs text-slate-400">{mode === 'file' ? '空目录' : '没有子目录'}</div>}
            {data?.entries.map((e) => (
              <div
                key={e.path}
                onClick={() => (e.dir ? go(e.path) : setFile(e.path))}
                onDoubleClick={() => !e.dir && pick(e.path)}
                className={cx('group flex cursor-pointer items-center gap-2 border-b border-slate-50 px-3 py-1.5 text-sm hover:bg-slate-50', file === e.path && 'bg-indigo-50')}
              >
                {e.dir ? (e.skill ? <FolderOpen className="size-4 shrink-0 text-indigo-500" /> : <Folder className="size-4 shrink-0 text-amber-500" />) : <FileText className="size-4 shrink-0 text-slate-400" />}
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
                {e.skill && <Badge tone="indigo">技能</Badge>}
                {e.dir && mode === 'dir' && (
                  <button onClick={(ev) => (ev.stopPropagation(), pick(e.path))} className="rounded px-1.5 py-0.5 text-xs text-indigo-600 opacity-0 group-hover:opacity-100 hover:bg-indigo-100">
                    选择
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">浏览的是评测服务所在机器的目录。单击文件夹进入，悬停后点击「选择」可直接选中；带「技能」标记的目录包含 SKILL.md。</p>
        </div>
      </div>
    </Modal>
  );
}
