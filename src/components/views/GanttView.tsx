'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  addDays,
  dayOfWeek,
  flattenTree,
  fromDayNumber,
  previewResize,
  taskStatus,
  toDayNumber,
  todayIso,
  type TreeRow,
} from '@/lib/scheduling';
import { useStoredState } from '@/lib/client/useSchedule';
import type { TaskDependency, TaskItem } from '@/lib/types';
import { Button, Segmented, cx } from '../ui';
import type { ViewProps } from './types';

type Zoom = 'days' | 'weeks' | 'months';
const ZOOMS = ['days', 'weeks', 'months'] as const;
const PX_PER_DAY: Record<Zoom, number> = { days: 32, weeks: 12, months: 4 };
const PAD_DAYS: Record<Zoom, number> = { days: 7, weeks: 21, months: 45 };

const ROW_H = 34;
const BAR_H = 18;
const HEADER_H = 52;
const MILESTONE_R = 8;
const ARROW_GAP = 8;

type DragMode = 'move' | 'resize-start' | 'resize-end';
interface DragState {
  id: string;
  mode: DragMode;
  originX: number;
  origStart: string;
  origDuration: number;
  delta: number;
  error: string | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtShort = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8))}`;

interface Segment {
  x: number;
  width: number;
  label: string;
  key: string;
}

/** Contiguous header cells between [day0, day0 + days). */
function headerSegments(day0: number, days: number, unit: 'day' | 'week' | 'month' | 'year', px: number): Segment[] {
  const out: Segment[] = [];
  let d = day0;
  const end = day0 + days;
  while (d < end) {
    const iso = fromDayNumber(d);
    let next: number;
    let label: string;
    if (unit === 'day') {
      next = d + 1;
      label = `${'SMTWTFS'[dayOfWeek(iso)]} ${Number(iso.slice(8))}`;
    } else if (unit === 'week') {
      next = d + 7 - ((dayOfWeek(iso) + 6) % 7);
      label = fmtShort(iso);
    } else if (unit === 'month') {
      const [y, m] = iso.split('-').map(Number);
      next = toDayNumber(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10));
      label = `${MONTHS[m - 1]} ${y}`;
    } else {
      next = toDayNumber(`${Number(iso.slice(0, 4)) + 1}-01-01`);
      label = iso.slice(0, 4);
    }
    next = Math.min(next, end);
    out.push({ x: (d - day0) * px, width: (next - d) * px, label, key: `${unit}-${d}` });
    d = next;
  }
  return out;
}

function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

export function GanttView({ tasks, canEdit, scheduleMode, onOpen, onAdd, onUpdate }: ViewProps) {
  const [zoom, setZoom] = useStoredState<Zoom>('gantt.zoom', 'days', ZOOMS);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<DragState | null>(null);
  const [preview, setPreview] = useState<TaskItem[] | null>(null);
  const [saving, setSaving] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const narrow = useNarrow();
  const leftW = narrow ? 170 : 380;
  const px = PX_PER_DAY[zoom];
  const today = todayIso();

  const shown = preview ?? tasks;
  // Row order comes from committed dates so rows don't reshuffle mid-drag;
  // the preview only moves the bars.
  const rows = useMemo(() => {
    const base = flattenTree(tasks, collapsed);
    if (!preview) return base;
    const byId = new Map(preview.map((t) => [t.id, t]));
    return base.map((r) => ({ ...r, task: byId.get(r.task.id) ?? r.task }));
  }, [tasks, preview, collapsed]);
  const rowIndex = useMemo(() => new Map(rows.map((r, i) => [r.task.id, i])), [rows]);
  const original = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  // Timeline bounds from committed + preview dates so dragging never clips.
  const { day0, days } = useMemo(() => {
    const all = [...tasks, ...(preview ?? [])];
    const starts = all.map((t) => toDayNumber(t.startDate));
    const ends = all.map((t) => toDayNumber(t.endDate));
    const t0 = toDayNumber(today);
    let lo = Math.min(t0, ...starts) - PAD_DAYS[zoom];
    const hi = Math.max(t0, ...ends) + PAD_DAYS[zoom] * 2;
    const loIso = fromDayNumber(lo);
    if (zoom === 'months') lo = toDayNumber(`${loIso.slice(0, 7)}-01`);
    else lo -= (dayOfWeek(loIso) + 6) % 7; // align to Monday
    return { day0: lo, days: hi - lo + 1 };
  }, [tasks, preview, zoom, today]);

  const chartW = days * px;
  const bodyH = Math.max(rows.length * ROW_H, 200);
  const xOf = useCallback((iso: string) => (toDayNumber(iso) - day0) * px, [day0, px]);

  const scrollToToday = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, xOf(today) - (el.clientWidth - leftW) / 3);
  }, [xOf, today, leftW]);

  const didInitialScroll = useRef(false);
  useEffect(() => {
    if (!didInitialScroll.current && tasks.length) {
      didInitialScroll.current = true;
      scrollToToday();
    }
  }, [tasks.length, scrollToToday]);
  useEffect(() => scrollToToday(), [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Drag to move / resize -----------------------------------------------
  const computePreview = (d: DragState, delta: number): { tasks: TaskItem[] | null; error: string | null } => {
    let start = d.origStart;
    let duration = d.origDuration;
    if (d.mode === 'move') start = addDays(d.origStart, delta);
    else if (d.mode === 'resize-end') duration = Math.max(1, d.origDuration + delta);
    else {
      const capped = Math.min(delta, d.origDuration - 1);
      start = addDays(d.origStart, capped);
      duration = d.origDuration - capped;
    }
    try {
      return { tasks: previewResize(tasks, d.id, start, duration, { mode: scheduleMode }).tasks, error: null };
    } catch (e) {
      return { tasks: null, error: (e as Error).message };
    }
  };

  const onBarPointerDown = (e: ReactPointerEvent, task: TaskItem, mode: DragMode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (!canEdit || saving) {
      onOpen(task);
      return;
    }
    (e.currentTarget as Element).closest('svg')!.setPointerCapture(e.pointerId);
    setDrag({ id: task.id, mode, originX: e.clientX, origStart: task.startDate, origDuration: task.durationDays, delta: 0, error: null });
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const delta = Math.round((e.clientX - drag.originX) / px);
    if (delta === drag.delta) return;
    const p = computePreview(drag, delta);
    setDrag({ ...drag, delta, error: p.error });
    setPreview(delta === 0 ? null : p.tasks);
  };

  const endDrag = async () => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    const task = original.get(d.id)!;
    if (d.delta === 0) {
      setPreview(null);
      onOpen(task);
      return;
    }
    if (d.error || !preview) {
      setPreview(null);
      if (d.error) window.alert(d.error);
      return;
    }
    const moved = preview.find((t) => t.id === d.id)!;
    setSaving(true);
    try {
      await onUpdate(d.id, {
        startDate: requestedStart(d),
        ...(task.type === 'task' ? { durationDays: moved.durationDays } : {}),
      });
    } catch (err) {
      window.alert((err as Error).message);
    } finally {
      setSaving(false);
      setPreview(null);
    }
  };

  /** The date the user dropped on (the engine may push it later). */
  const requestedStart = (d: DragState) =>
    d.mode === 'move' ? addDays(d.origStart, d.delta) : d.mode === 'resize-start' ? addDays(d.origStart, Math.min(d.delta, d.origDuration - 1)) : d.origStart;

  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrag(null);
        setPreview(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drag]);

  const toggle = (id: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allSummaryIds = useMemo(() => flattenTree(tasks).filter((r) => r.hasChildren).map((r) => r.task.id), [tasks]);

  const topUnit = zoom === 'months' ? 'year' : 'month';
  const bottomUnit = zoom === 'days' ? 'day' : zoom === 'weeks' ? 'week' : 'month';
  const topSegs = useMemo(() => headerSegments(day0, days, topUnit, px), [day0, days, topUnit, px]);
  const bottomSegs = useMemo(() => headerSegments(day0, days, bottomUnit, px), [day0, days, bottomUnit, px]);
  const dragged = drag ? shown.find((t) => t.id === drag.id) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
        <Segmented label="Zoom" value={zoom} onChange={setZoom} options={[{ value: 'days', label: 'Days' }, { value: 'weeks', label: 'Weeks' }, { value: 'months', label: 'Months' }]} />
        <Button size="sm" onClick={scrollToToday}>
          Today
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set())}>
          Expand all
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set(allSummaryIds))}>
          Collapse all
        </Button>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-500">
          {drag && dragged && (
            <span className={cx('rounded px-2 py-0.5 font-medium', drag.error ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800')}>
              {drag.error ?? `${fmtShort(dragged.startDate)} → ${fmtShort(dragged.endDate)} · ${dragged.durationDays}d`}
            </span>
          )}
          {saving && <span className="text-indigo-600">Saving…</span>}
          {canEdit && !drag && <span className="hidden md:inline">Drag bars to move · drag edges to resize · Esc cancels</span>}
          <LegendSwatches />
        </div>
      </div>

      <div ref={scroller} className="relative flex-1 overflow-auto overscroll-contain" style={{ touchAction: drag ? 'none' : undefined }}>
        <div style={{ width: leftW + chartW }}>
          {/* Header row */}
          <div className="sticky top-0 z-20 flex" style={{ height: HEADER_H }}>
            <div className="sticky left-0 z-30 flex shrink-0 items-end border-b border-r border-slate-200 bg-slate-50 px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500" style={{ width: leftW }}>
              <span className="flex-1">Task</span>
              {!narrow && <span className="w-14 text-right">Dur.</span>}
              {!narrow && <span className="w-24 pl-3">Status</span>}
            </div>
            <svg width={chartW} height={HEADER_H} className="block shrink-0 border-b border-slate-200 bg-slate-50" aria-hidden>
              {topSegs.map((s) => (
                <g key={s.key}>
                  <line x1={s.x} x2={s.x} y1={0} y2={HEADER_H / 2} className="stroke-slate-200" />
                  <text x={s.x + 6} y={17} className="fill-slate-700 text-[11px] font-semibold">
                    {s.width > 40 ? s.label : ''}
                  </text>
                </g>
              ))}
              <line x1={0} x2={chartW} y1={HEADER_H / 2} y2={HEADER_H / 2} className="stroke-slate-200" />
              {bottomSegs.map((s) => (
                <g key={s.key}>
                  <line x1={s.x} x2={s.x} y1={HEADER_H / 2} y2={HEADER_H} className="stroke-slate-200" />
                  <text x={s.x + s.width / 2} y={HEADER_H - 9} textAnchor="middle" className={cx('text-[10px]', zoom === 'days' && fromDayNumber(day0 + s.x / px) === today ? 'fill-indigo-600 font-bold' : 'fill-slate-500')}>
                    {s.width >= 24 ? s.label : ''}
                  </text>
                </g>
              ))}
            </svg>
          </div>

          {/* Body */}
          <div className="flex">
            <div className="sticky left-0 z-10 shrink-0 border-r border-slate-200 bg-white" style={{ width: leftW, minHeight: bodyH }}>
              {rows.map((r) => (
                <TreeRowView key={r.task.id} row={r} narrow={narrow} collapsed={collapsed.has(r.task.id)} canEdit={canEdit} onToggle={toggle} onOpen={onOpen} onAdd={onAdd} />
              ))}
              {rows.length === 0 && <p className="p-6 text-sm text-slate-500">Nothing scheduled yet.</p>}
            </div>

            <svg
              width={chartW}
              height={bodyH}
              className={cx('block shrink-0 select-none', drag && 'cursor-grabbing')}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={() => (setDrag(null), setPreview(null))}
              role="img"
              aria-label="Gantt chart timeline"
            >
              <defs>
                <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0 8 4 0 8Z" className="fill-slate-400" />
                </marker>
                <marker id="arrow-critical" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0 8 4 0 8Z" className="fill-red-500" />
                </marker>
                <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="6" className="stroke-white/40" strokeWidth="3" />
                </pattern>
              </defs>

              <GridLayer rows={rows} zoom={zoom} day0={day0} days={days} px={px} chartW={chartW} bodyH={bodyH} segs={bottomSegs} />

              {/* Today */}
              <line x1={xOf(today) + (zoom === 'days' ? px / 2 : 0)} x2={xOf(today) + (zoom === 'days' ? px / 2 : 0)} y1={0} y2={bodyH} className="stroke-indigo-500" strokeWidth={1.5} strokeDasharray="4 3" />

              {/* Dependency arrows */}
              <g fill="none" strokeWidth={1.25}>
                {rows.flatMap((r) =>
                  r.task.dependencies.map((dep) => {
                    const pi = rowIndex.get(dep.predecessorId);
                    if (pi === undefined) return null;
                    const pred = rows[pi].task;
                    const crit = Boolean(pred.isCritical && r.task.isCritical);
                    return (
                      <path
                        key={`${dep.predecessorId}-${r.task.id}`}
                        d={linkPath(pred, rows[pi].hasChildren, pi, r.task, r.hasChildren, rowIndex.get(r.task.id)!, dep, xOf, px)}
                        className={crit ? 'stroke-red-500' : 'stroke-slate-400'}
                        markerEnd={`url(#${crit ? 'arrow-critical' : 'arrow'})`}
                      />
                    );
                  }),
                )}
              </g>

              {/* Ghost of the bar being dragged */}
              {drag && original.get(drag.id) && rowIndex.has(drag.id) && (
                <Ghost task={original.get(drag.id)!} row={rowIndex.get(drag.id)!} xOf={xOf} px={px} />
              )}

              {rows.map((r, i) => (
                <Bar
                  key={r.task.id}
                  row={r}
                  index={i}
                  xOf={xOf}
                  px={px}
                  canEdit={canEdit}
                  moved={Boolean(preview && original.get(r.task.id)?.startDate !== r.task.startDate)}
                  dragging={drag?.id === r.task.id}
                  onPointerDown={onBarPointerDown}
                  onOpen={onOpen}
                />
              ))}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

function TreeRowView({
  row,
  narrow,
  collapsed,
  canEdit,
  onToggle,
  onOpen,
  onAdd,
}: {
  row: TreeRow;
  narrow: boolean;
  collapsed: boolean;
  canEdit: boolean;
  onToggle: (id: string) => void;
  onOpen: (t: TaskItem) => void;
  onAdd: ViewProps['onAdd'];
}) {
  const { task, depth, wbs, hasChildren } = row;
  const status = taskStatus(task);
  return (
    <div className={cx('group flex items-center border-b border-slate-100 pr-2 text-sm', task.isCritical && 'shadow-[inset_3px_0_0_#dc2626]')} style={{ height: ROW_H }}>
      <div className="flex min-w-0 flex-1 items-center gap-1" style={{ paddingLeft: 8 + depth * 14 }}>
        {hasChildren ? (
          <button type="button" onClick={() => onToggle(task.id)} aria-label={collapsed ? `Expand ${task.title}` : `Collapse ${task.title}`} aria-expanded={!collapsed} className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100">
            <svg viewBox="0 0 20 20" className={cx('h-3.5 w-3.5 transition-transform', !collapsed && 'rotate-90')} fill="currentColor"><path d="M7.2 4.2a.75.75 0 0 1 1.06 0l5.25 5.25a.75.75 0 0 1 0 1.06L8.26 15.8a.75.75 0 1 1-1.06-1.06L11.94 10 7.2 5.26a.75.75 0 0 1 0-1.06Z" /></svg>
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <span className="shrink-0 font-mono text-[10px] text-slate-400">{wbs}</span>
        <button type="button" onClick={() => onOpen(task)} className={cx('min-w-0 truncate text-left hover:underline', hasChildren ? 'font-semibold text-slate-900' : 'text-slate-700', task.isCritical && 'text-red-700')} title={task.title}>
          {task.type === 'milestone' && '◆ '}
          {task.title}
        </button>
        {canEdit && task.type === 'task' && (
          <button type="button" onClick={() => onAdd({ parentId: task.id, startDate: task.startDate })} className="ml-1 hidden h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 group-hover:flex" aria-label={`Add subtask to ${task.title}`} title="Add subtask">
            +
          </button>
        )}
      </div>
      {!narrow && <span className="w-14 shrink-0 text-right text-xs tabular-nums text-slate-500">{task.type === 'milestone' ? '—' : `${task.durationDays}d`}</span>}
      {!narrow && (
        <span className="w-24 shrink-0 pl-3">
          <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium', status === 'Complete' ? 'bg-emerald-50 text-emerald-700' : status === 'In progress' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-600')}>
            {status === 'In progress' ? `${task.progressPercent}%` : status}
          </span>
        </span>
      )}
    </div>
  );
}

function GridLayer({ rows, zoom, day0, days, px, chartW, bodyH, segs }: { rows: TreeRow[]; zoom: Zoom; day0: number; days: number; px: number; chartW: number; bodyH: number; segs: Segment[] }) {
  return (
    <g aria-hidden>
      {zoom === 'days' &&
        Array.from({ length: days }, (_, i) => {
          const dow = dayOfWeek(fromDayNumber(day0 + i));
          return dow === 0 || dow === 6 ? <rect key={i} x={i * px} y={0} width={px} height={bodyH} className="fill-slate-50" /> : null;
        })}
      {rows.map((r, i) => r.task.isCritical && <rect key={r.task.id} x={0} y={i * ROW_H} width={chartW} height={ROW_H} className="fill-red-50/40" />)}
      {segs.map((s) => (
        <line key={s.key} x1={s.x} x2={s.x} y1={0} y2={bodyH} className="stroke-slate-100" />
      ))}
      {rows.map((r, i) => (
        <line key={r.task.id} x1={0} x2={chartW} y1={(i + 1) * ROW_H} y2={(i + 1) * ROW_H} className="stroke-slate-100" />
      ))}
    </g>
  );
}

function barGeometry(task: TaskItem, row: number, xOf: (iso: string) => number, px: number) {
  const x = xOf(task.startDate);
  const w = Math.max(task.durationDays, 0) * px;
  const cy = row * ROW_H + ROW_H / 2;
  return { x, w, cy, y: cy - BAR_H / 2 };
}

function Bar({
  row,
  index,
  xOf,
  px,
  canEdit,
  moved,
  dragging,
  onPointerDown,
  onOpen,
}: {
  row: TreeRow;
  index: number;
  xOf: (iso: string) => number;
  px: number;
  canEdit: boolean;
  moved: boolean;
  dragging: boolean;
  onPointerDown: (e: ReactPointerEvent, t: TaskItem, mode: DragMode) => void;
  onOpen: (t: TaskItem) => void;
}) {
  const { task, hasChildren } = row;
  const { x, w, cy, y } = barGeometry(task, index, xOf, px);
  const tip = `${task.title}\n${task.startDate}${task.type === 'task' ? ` → ${task.endDate} (${task.durationDays}d)` : ''}\n${task.isCritical ? 'Critical path' : `Float: ${task.totalFloat ?? 0}d`} · ${task.progressPercent}% complete`;

  if (task.type === 'milestone' && !hasChildren) {
    const r = MILESTONE_R;
    return (
      <g className={cx(canEdit ? 'cursor-grab' : 'cursor-pointer')} onPointerDown={(e) => onPointerDown(e, task, 'move')}>
        <title>{tip}</title>
        <path d={`M${x} ${cy - r} L${x + r} ${cy} L${x} ${cy + r} L${x - r} ${cy} Z`} className={cx(task.isCritical ? 'fill-red-600' : 'fill-slate-800', moved && 'stroke-amber-400', 'stroke-white')} strokeWidth={moved ? 2.5 : 1.5} />
        <text x={x + r + 5} y={cy + 4} className={cx('pointer-events-none text-[11px] font-semibold', task.isCritical ? 'fill-red-700' : 'fill-slate-700')}>
          {task.title}
        </text>
      </g>
    );
  }

  if (hasChildren) {
    // Summary bracket: rolled up, not draggable.
    const top = cy - 5;
    return (
      <g className="cursor-pointer" onClick={() => onOpen(task)}>
        <title>{tip}</title>
        <path
          d={`M${x} ${top} H${x + w} V${top + 12} L${x + w - 6} ${top + 6} H${x + 6} L${x} ${top + 12} Z`}
          className={task.isCritical ? 'fill-red-800' : 'fill-slate-700'}
        />
        {w > 0 && <rect x={x} y={top} width={(w * task.progressPercent) / 100} height={4} className="fill-emerald-400" />}
      </g>
    );
  }

  const label = w > 60 ? task.title : '';
  return (
    <g>
      <title>{tip}</title>
      <g className={cx(canEdit ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-pointer')} onPointerDown={(e) => onPointerDown(e, task, 'move')}>
        <rect x={x} y={y} width={w} height={BAR_H} rx={4} className={cx(task.isCritical ? 'fill-red-500' : 'fill-indigo-500', dragging && 'opacity-90')} />
        <rect x={x} y={y} width={(w * task.progressPercent) / 100} height={BAR_H} rx={4} className={task.isCritical ? 'fill-red-700' : 'fill-indigo-700'} />
        {task.isCritical && <rect x={x} y={y} width={w} height={BAR_H} rx={4} fill="url(#hatch)" opacity={0.35} />}
        {moved && <rect x={x - 1.5} y={y - 1.5} width={w + 3} height={BAR_H + 3} rx={5} fill="none" className="stroke-amber-400" strokeWidth={2} />}
        {label && (
          <text x={x + 6} y={cy + 4} className="pointer-events-none fill-white text-[11px] font-medium">
            <tspan>{label.length * 6.2 > w - 10 ? `${label.slice(0, Math.max(0, Math.floor((w - 16) / 6.2)))}…` : label}</tspan>
          </text>
        )}
      </g>
      {!label && (
        <text x={x + w + 6} y={cy + 4} className={cx('pointer-events-none text-[11px]', task.isCritical ? 'fill-red-700' : 'fill-slate-600')}>
          {task.title}
        </text>
      )}
      {canEdit && (
        <>
          <rect x={x - 3} y={y} width={7} height={BAR_H} className="cursor-ew-resize fill-transparent" onPointerDown={(e) => onPointerDown(e, task, 'resize-start')} />
          <rect x={x + w - 4} y={y} width={7} height={BAR_H} className="cursor-ew-resize fill-transparent" onPointerDown={(e) => onPointerDown(e, task, 'resize-end')} />
        </>
      )}
    </g>
  );
}

function Ghost({ task, row, xOf, px }: { task: TaskItem; row: number; xOf: (iso: string) => number; px: number }) {
  const { x, w, y, cy } = barGeometry(task, row, xOf, px);
  if (task.type === 'milestone') {
    const r = MILESTONE_R;
    return <path d={`M${x} ${cy - r} L${x + r} ${cy} L${x} ${cy + r} L${x - r} ${cy} Z`} fill="none" className="stroke-slate-400" strokeDasharray="3 2" />;
  }
  return <rect x={x} y={y} width={w} height={BAR_H} rx={4} fill="none" className="stroke-slate-400" strokeDasharray="4 3" />;
}

/**
 * Orthogonal connector from the predecessor's anchor to the successor's.
 * Finish anchors exit/enter on the right edge, start anchors on the left.
 */
function linkPath(
  pred: TaskItem,
  predSummary: boolean,
  predRow: number,
  succ: TaskItem,
  succSummary: boolean,
  succRow: number,
  dep: TaskDependency,
  xOf: (iso: string) => number,
  px: number,
): string {
  const anchor = (t: TaskItem, summary: boolean, row: number, edge: 'start' | 'finish') => {
    const { x, w, cy } = barGeometry(t, row, xOf, px);
    const milestone = t.type === 'milestone' && !summary;
    const xs = milestone ? (edge === 'start' ? x - MILESTONE_R : x + MILESTONE_R) : edge === 'start' ? x : x + w;
    return { x: xs, y: cy };
  };
  const fromEdge = dep.type === 'FS' || dep.type === 'FF' ? 'finish' : 'start';
  const toEdge = dep.type === 'FS' || dep.type === 'SS' ? 'start' : 'finish';
  const a = anchor(pred, predSummary, predRow, fromEdge);
  const b = anchor(succ, succSummary, succRow, toEdge);
  const outDir = fromEdge === 'finish' ? 1 : -1;
  const inDir = toEdge === 'start' ? 1 : -1; // direction of travel when arriving
  const p1 = a.x + outDir * ARROW_GAP;
  const entry = b.x - inDir * ARROW_GAP;
  const direct = inDir === 1 ? p1 <= entry : p1 >= entry;
  if (direct) return `M${a.x} ${a.y} H${p1} V${b.y} H${b.x}`;
  const midY = b.y > a.y ? a.y + ROW_H / 2 : a.y - ROW_H / 2;
  return `M${a.x} ${a.y} H${p1} V${midY} H${entry} V${b.y} H${b.x}`;
}

function LegendSwatches() {
  return (
    <span className="hidden items-center gap-3 lg:inline-flex">
      <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded-sm bg-indigo-500" />Task</span>
      <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded-sm bg-red-500" />Critical</span>
      <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rotate-45 bg-slate-800" />Milestone</span>
      <span className="inline-flex items-center gap-1"><span className="h-1.5 w-4 bg-slate-700" />Summary</span>
    </span>
  );
}
