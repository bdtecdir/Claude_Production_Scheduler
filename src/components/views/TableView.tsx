'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { flattenTree, formatDependency, taskStatus, type TreeRow } from '@/lib/scheduling';
import type { TaskItem, TaskPatch } from '@/lib/types';
import { Button, CriticalBadge, Diamond, Segmented, cx, inputClass } from '../ui';
import type { ViewProps } from './types';

type SortKey = 'wbs' | 'title' | 'type' | 'startDate' | 'endDate' | 'durationDays' | 'totalFloat' | 'progressPercent';
type TypeFilter = 'all' | 'task' | 'milestone';

const COLUMNS: { key: SortKey | null; label: string; className?: string }[] = [
  { key: 'wbs', label: 'WBS', className: 'w-16' },
  { key: 'title', label: 'Title', className: 'min-w-[16rem]' },
  { key: 'type', label: 'Type', className: 'w-24' },
  { key: 'startDate', label: 'Start', className: 'w-32' },
  { key: 'endDate', label: 'End', className: 'w-32' },
  { key: 'durationDays', label: 'Duration', className: 'w-24 text-right' },
  { key: null, label: 'Predecessors', className: 'w-40' },
  { key: 'progressPercent', label: 'Progress', className: 'w-28' },
  { key: 'totalFloat', label: 'Critical', className: 'w-28' },
];

function compareWbs(a: string, b: string) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? -1) - (pb[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

export function TableView({ tasks, canEdit, onOpen, onAdd, onUpdate, onDelete, onDuplicate }: ViewProps) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'wbs', dir: 1 });

  const rows = useMemo(() => flattenTree(tasks), [tasks]);
  const wbs = useMemo(() => new Map(rows.map((r) => [r.task.id, r.wbs])), [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = rows.filter(({ task, wbs: code }) => {
      if (typeFilter !== 'all' && task.type !== typeFilter) return false;
      if (criticalOnly && !task.isCritical) return false;
      if (!q) return true;
      return [task.title, task.description ?? '', code, ...(task.tags ?? [])].some((s) => s.toLowerCase().includes(q));
    });
    if (sort.key === 'wbs') return sort.dir === 1 ? filtered : [...filtered].reverse();
    const key = sort.key;
    return [...filtered].sort((a, b) => {
      const va = key === 'type' ? a.task.type : (a.task[key] ?? 0);
      const vb = key === 'type' ? b.task.type : (b.task[key] ?? 0);
      const d = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return d * sort.dir || compareWbs(a.wbs, b.wbs);
    });
  }, [rows, query, typeFilter, criticalOnly, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  const indent = sort.key === 'wbs' && !query && typeFilter === 'all' && !criticalOnly;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
        <div className="relative w-full sm:w-72">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, notes, tags, WBS…" className={`${inputClass} pl-8`} aria-label="Search tasks" />
          <svg className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden><path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.45 4.39l3.08 3.08a.75.75 0 1 1-1.06 1.06l-3.08-3.08A7 7 0 0 1 2 9Z" clipRule="evenodd" /></svg>
        </div>
        <Segmented size="sm" label="Filter by type" value={typeFilter} onChange={setTypeFilter} options={[{ value: 'all', label: 'All' }, { value: 'task', label: 'Tasks' }, { value: 'milestone', label: 'Milestones' }]} />
        <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
          <input type="checkbox" checked={criticalOnly} onChange={(e) => setCriticalOnly(e.target.checked)} className="rounded border-slate-300 text-red-600 focus:ring-red-500" />
          Critical only
        </label>
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          <span>
            {visible.length} of {rows.length} items
          </span>
          <Button size="sm" variant={sort.key === 'startDate' ? 'primary' : 'secondary'} onClick={() => setSort({ key: 'startDate', dir: 1 })}>
            By date
          </Button>
          <Button size="sm" variant={sort.key === 'totalFloat' ? 'primary' : 'secondary'} onClick={() => setSort({ key: 'totalFloat', dir: 1 })}>
            By criticality
          </Button>
          {sort.key !== 'wbs' && (
            <Button size="sm" variant="ghost" onClick={() => setSort({ key: 'wbs', dir: 1 })}>
              Reset
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full min-w-[1000px] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.label} scope="col" className={cx('border-b border-slate-200 px-3 py-2', c.className)} aria-sort={c.key && sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                  {c.key ? (
                    <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-slate-800" onClick={() => toggleSort(c.key!)}>
                      {c.label}
                      <span className="text-[10px]">{sort.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : ''}</span>
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
              <th scope="col" className="w-12 border-b border-slate-200 px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <Row key={row.task.id} row={row} wbs={wbs} indent={indent} canEdit={canEdit} onOpen={onOpen} onAdd={onAdd} onUpdate={onUpdate} onDelete={onDelete} onDuplicate={onDuplicate} />
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-3 py-12 text-center text-slate-500">
                  {rows.length === 0 ? 'Nothing scheduled yet.' : 'No items match these filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({
  row,
  wbs,
  indent,
  canEdit,
  onOpen,
  onAdd,
  onUpdate,
  onDelete,
  onDuplicate,
}: Pick<ViewProps, 'canEdit' | 'onOpen' | 'onAdd' | 'onUpdate' | 'onDelete' | 'onDuplicate'> & { row: TreeRow; wbs: Map<string, string>; indent: boolean }) {
  const { task, hasChildren } = row;
  const locked = !canEdit || hasChildren; // summary values are rolled up
  const save = (patch: TaskPatch) => onUpdate(task.id, patch);

  return (
    <tr className={cx('group hover:bg-indigo-50/40', hasChildren && 'font-semibold', task.isCritical && 'bg-red-50/30')}>
      <Td className="font-mono text-xs text-slate-500">{row.wbs}</Td>
      <Td>
        <div className="flex items-center gap-1.5" style={{ paddingLeft: indent ? row.depth * 16 : 0 }}>
          {task.type === 'milestone' && <Diamond critical={task.isCritical} />}
          {canEdit ? (
            <InlineText value={task.title} onSave={(title) => save({ title })} />
          ) : (
            <button type="button" className="truncate text-left hover:underline" onClick={() => onOpen(task)}>
              {task.title}
            </button>
          )}
          {(task.tags ?? []).map((t) => (
            <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
              {t}
            </span>
          ))}
        </div>
      </Td>
      <Td className="text-xs text-slate-600">{hasChildren ? 'Summary' : task.type === 'milestone' ? 'Milestone' : 'Task'}</Td>
      <Td>{locked ? <span className="tabular-nums">{task.startDate}</span> : <InlineDate value={task.startDate} onSave={(startDate) => save({ startDate })} />}</Td>
      <Td className="tabular-nums">{task.endDate}</Td>
      <Td className="text-right tabular-nums">
        {locked || task.type === 'milestone' ? (
          `${task.durationDays}d`
        ) : (
          <InlineNumber value={task.durationDays} min={1} suffix="d" onSave={(durationDays) => save({ durationDays })} />
        )}
      </Td>
      <Td className="font-mono text-xs text-slate-600">{task.dependencies.map((d) => formatDependency(d, wbs)).join(', ') || '—'}</Td>
      <Td>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full bg-indigo-500" style={{ width: `${task.progressPercent}%` }} />
          </div>
          {locked || task.type === 'milestone' ? (
            <span className="text-xs tabular-nums text-slate-600" title={taskStatus(task)}>
              {task.progressPercent}%
            </span>
          ) : (
            <InlineNumber value={task.progressPercent} min={0} max={100} suffix="%" onSave={(progressPercent) => save({ progressPercent })} />
          )}
        </div>
      </Td>
      <Td>
        <CriticalBadge critical={task.isCritical} float={task.totalFloat} />
      </Td>
      <Td className="text-right">
        <ActionMenu task={task} canEdit={canEdit} onOpen={onOpen} onAdd={onAdd} onDelete={onDelete} onDuplicate={onDuplicate} />
      </Td>
    </tr>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cx('whitespace-nowrap border-b border-slate-100 px-3 py-1.5 align-middle', className)}>{children}</td>;
}

function useInline<T>(value: T, onSave: (v: T) => Promise<unknown>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(value), [value]);
  const commit = async (v: T) => {
    setEditing(false);
    if (v === value) return;
    setBusy(true);
    try {
      await onSave(v);
    } catch (e) {
      setDraft(value);
      window.alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { editing, setEditing, draft, setDraft, commit, busy };
}

const cellButton = 'rounded px-1 -mx-1 text-left hover:bg-white hover:ring-1 hover:ring-slate-300 disabled:opacity-50';

function InlineText({ value, onSave }: { value: string; onSave: (v: string) => Promise<unknown> }) {
  const s = useInline(value, onSave);
  if (!s.editing) {
    return (
      <button type="button" className={cx(cellButton, 'truncate')} onClick={() => s.setEditing(true)} disabled={s.busy} title="Click to rename">
        {s.draft}
      </button>
    );
  }
  return (
    <input
      autoFocus
      className={`${inputClass} h-7 py-0`}
      value={s.draft}
      onChange={(e) => s.setDraft(e.target.value)}
      onBlur={() => s.draft.trim() && s.commit(s.draft.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && s.draft.trim()) void s.commit(s.draft.trim());
        if (e.key === 'Escape') {
          s.setDraft(value);
          s.setEditing(false);
        }
      }}
    />
  );
}

function InlineDate({ value, onSave }: { value: string; onSave: (v: string) => Promise<unknown> }) {
  const s = useInline(value, onSave);
  if (!s.editing) {
    return (
      <button type="button" className={cx(cellButton, 'tabular-nums')} onClick={() => s.setEditing(true)} disabled={s.busy}>
        {s.draft}
      </button>
    );
  }
  return (
    <input
      autoFocus
      type="date"
      className={`${inputClass} h-7 py-0`}
      value={s.draft}
      onChange={(e) => e.target.value && s.setDraft(e.target.value)}
      onBlur={() => s.commit(s.draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void s.commit(s.draft);
        if (e.key === 'Escape') s.setEditing(false);
      }}
    />
  );
}

function InlineNumber({ value, onSave, min, max, suffix }: { value: number; onSave: (v: number) => Promise<unknown>; min: number; max?: number; suffix: string }) {
  const s = useInline(value, onSave);
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min, Math.round(n || min)));
  if (!s.editing) {
    return (
      <button type="button" className={cx(cellButton, 'tabular-nums text-xs')} onClick={() => s.setEditing(true)} disabled={s.busy}>
        {s.draft}
        {suffix}
      </button>
    );
  }
  return (
    <input
      autoFocus
      type="number"
      min={min}
      max={max}
      className={`${inputClass} h-7 w-16 py-0 text-right`}
      value={s.draft}
      onChange={(e) => s.setDraft(Number(e.target.value))}
      onBlur={() => s.commit(clamp(s.draft))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void s.commit(clamp(s.draft));
        if (e.key === 'Escape') s.setEditing(false);
      }}
    />
  );
}

function ActionMenu({ task, canEdit, onOpen, onAdd, onDelete, onDuplicate }: { task: TaskItem } & Pick<ViewProps, 'canEdit' | 'onOpen' | 'onAdd' | 'onDelete' | 'onDuplicate'>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!canEdit) {
    return (
      <Button size="sm" variant="ghost" onClick={() => onOpen(task)}>
        View
      </Button>
    );
  }
  const item = 'block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100';
  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Actions for ${task.title}`} onClick={() => setOpen((o) => !o)} className="rounded px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
        ⋯
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-md bg-white py-1 text-slate-700 shadow-lg ring-1 ring-slate-200">
          <button role="menuitem" type="button" className={item} onClick={() => (setOpen(false), onOpen(task))}>
            Edit
          </button>
          {task.type === 'task' && (
            <button role="menuitem" type="button" className={item} onClick={() => (setOpen(false), onAdd({ parentId: task.id, startDate: task.startDate }))}>
              Add subtask
            </button>
          )}
          <button role="menuitem" type="button" className={item} onClick={() => (setOpen(false), onDuplicate(task))}>
            Duplicate…
          </button>
          <button role="menuitem" type="button" className={cx(item, 'text-red-600 hover:bg-red-50')} onClick={() => (setOpen(false), onDelete(task))}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
