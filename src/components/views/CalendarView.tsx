'use client';

import { useMemo, useState } from 'react';
import { addDays, buildHierarchy, dayOfWeek, diffDays, isSummary, todayIso } from '@/lib/scheduling';
import { useStoredState } from '@/lib/client/useSchedule';
import type { TaskItem } from '@/lib/types';
import { Button, Diamond, Segmented, cx } from '../ui';
import type { ViewProps } from './types';

type WeekStart = 'monday' | 'sunday';
const WEEK_STARTS = ['monday', 'sunday'] as const;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LANE_H = 22;
const HEADER_H = 28;

interface Placed {
  task: TaskItem;
  col: number;
  span: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

function monthStart(iso: string) {
  return `${iso.slice(0, 7)}-01`;
}

function shiftMonth(first: string, delta: number) {
  const [y, m] = first.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 10);
}

/** Greedy lane packing of the items overlapping one week. */
function layoutWeek(tasks: TaskItem[], weekStartIso: string): { placed: Placed[]; lanes: number } {
  const weekEnd = addDays(weekStartIso, 6);
  const items = tasks
    .filter((t) => t.startDate <= weekEnd && t.endDate >= weekStartIso)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || b.durationDays - a.durationDays || a.title.localeCompare(b.title));
  const laneEnds: number[] = [];
  const placed = items.map((task) => {
    const startCol = Math.max(0, diffDays(weekStartIso, task.startDate));
    const endCol = Math.min(6, diffDays(weekStartIso, task.endDate));
    let lane = laneEnds.findIndex((end) => end < startCol);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = endCol;
    return {
      task,
      col: startCol,
      span: endCol - startCol + 1,
      lane,
      continuesBefore: task.startDate < weekStartIso,
      continuesAfter: task.endDate > weekEnd,
    };
  });
  return { placed, lanes: laneEnds.length };
}

export function CalendarView({ tasks, canEdit, onOpen, onAdd }: ViewProps) {
  const today = todayIso();
  const [month, setMonth] = useState(() => monthStart(today));
  const [weekStart, setWeekStart] = useStoredState<WeekStart>('calendar.weekStart', 'monday', WEEK_STARTS);
  const [showSummaries, setShowSummaries] = useState(false);

  const items = useMemo(() => {
    const h = buildHierarchy(tasks);
    return showSummaries ? tasks : tasks.filter((t) => !isSummary(h, t.id));
  }, [tasks, showSummaries]);

  const weeks = useMemo(() => {
    const startDow = weekStart === 'monday' ? 1 : 0;
    const gridStart = addDays(month, -((dayOfWeek(month) - startDow + 7) % 7));
    const nextMonth = shiftMonth(month, 1);
    const out: string[] = [];
    for (let w = gridStart; w < nextMonth; w = addDays(w, 7)) out.push(w);
    return out;
  }, [month, weekStart]);

  const headers = weekStart === 'monday' ? [...DAY_NAMES.slice(1), DAY_NAMES[0]] : DAY_NAMES;
  const monthLabel = new Date(`${month}T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
            ‹
          </Button>
          <Button size="sm" onClick={() => setMonth(monthStart(today))}>
            Today
          </Button>
          <Button size="sm" variant="ghost" aria-label="Next month" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
            ›
          </Button>
        </div>
        <h2 className="min-w-[10rem] text-base font-semibold text-slate-900">{monthLabel}</h2>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
            <input type="checkbox" checked={showSummaries} onChange={(e) => setShowSummaries(e.target.checked)} className="rounded border-slate-300 text-indigo-600" />
            Show summary tasks
          </label>
          <Segmented
            label="Week starts on"
            value={weekStart}
            onChange={setWeekStart}
            options={[
              { value: 'monday', label: 'Monday Start' },
              { value: 'sunday', label: 'Sunday Start' },
            ]}
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="min-w-[720px]">
          <div className="sticky top-0 z-10 grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {headers.map((d) => (
              <div key={d} className="px-2 py-1.5">
                {d}
              </div>
            ))}
          </div>
          {weeks.map((w) => {
            const { placed, lanes } = layoutWeek(items, w);
            const height = Math.max(112, HEADER_H + lanes * LANE_H + 10);
            return (
              <div key={w} className="relative grid grid-cols-7 border-b border-slate-200" style={{ height }}>
                {Array.from({ length: 7 }, (_, i) => {
                  const day = addDays(w, i);
                  const inMonth = day.slice(0, 7) === month.slice(0, 7);
                  const dow = dayOfWeek(day);
                  const content = (
                    <span
                      className={cx(
                        'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-medium',
                        day === today ? 'bg-indigo-600 text-white' : inMonth ? 'text-slate-700' : 'text-slate-400',
                      )}
                    >
                      {Number(day.slice(8))}
                    </span>
                  );
                  const cellClass = cx(
                    'flex h-full items-start justify-start border-r border-slate-100 p-1 text-left last:border-r-0',
                    !inMonth && 'bg-slate-50/70',
                    (dow === 0 || dow === 6) && inMonth && 'bg-slate-50/40',
                  );
                  return canEdit ? (
                    <button key={day} type="button" className={cx(cellClass, 'hover:bg-indigo-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500')} onClick={() => onAdd({ startDate: day })} aria-label={`Add an item on ${day}`} title="Click to add an item on this day">
                      {content}
                    </button>
                  ) : (
                    <div key={day} className={cellClass}>
                      {content}
                    </div>
                  );
                })}
                {placed.map((p) => (
                  <CalendarItem key={p.task.id} p={p} onOpen={onOpen} />
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <Legend />
    </div>
  );
}

function CalendarItem({ p, onOpen }: { p: Placed; onOpen: (t: TaskItem) => void }) {
  const { task } = p;
  const style = {
    top: HEADER_H + p.lane * LANE_H,
    left: `calc(${(p.col / 7) * 100}% + 3px)`,
    width: `calc(${(p.span / 7) * 100}% - 6px)`,
    height: LANE_H - 3,
  };
  const label = `${task.title} · ${task.startDate}${task.type === 'task' ? ` → ${task.endDate}` : ''}${task.isCritical ? ' · critical' : ''}`;

  if (task.type === 'milestone') {
    return (
      <button type="button" style={style} title={label} onClick={() => onOpen(task)} className={cx('absolute z-[1] flex items-center gap-1 truncate rounded px-1 text-left text-[11px] font-semibold', task.isCritical ? 'text-red-700 hover:bg-red-50' : 'text-slate-800 hover:bg-slate-100')}>
        <Diamond critical={task.isCritical} />
        <span className="truncate">{task.title}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      style={style}
      title={label}
      onClick={() => onOpen(task)}
      className={cx(
        'absolute z-[1] flex items-center overflow-hidden px-1.5 text-left text-[11px] font-medium text-white shadow-sm',
        task.isCritical ? 'bg-red-600 hover:bg-red-500' : 'bg-indigo-500 hover:bg-indigo-400',
        p.continuesBefore ? 'rounded-l-none' : 'rounded-l',
        p.continuesAfter ? 'rounded-r-none' : 'rounded-r',
      )}
    >
      <span className="absolute inset-y-0 left-0 bg-black/15" style={{ width: `${task.progressPercent}%` }} aria-hidden />
      <span className="relative truncate">
        {p.continuesBefore && '◂ '}
        {task.title}
        {p.continuesAfter && ' ▸'}
      </span>
    </button>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 border-t border-slate-200 bg-white px-4 py-1.5 text-[11px] text-slate-500">
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-sm bg-indigo-500" />Task</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-sm bg-red-600" />Critical path</span>
      <span className="inline-flex items-center gap-1.5"><Diamond />Milestone</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-sm bg-indigo-500/60" />Darker band = progress</span>
    </div>
  );
}
