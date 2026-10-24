'use client';

import { useCallback, useEffect, useState } from 'react';
import { signIn, signOut } from 'next-auth/react';
import { buildHierarchy, descendants } from '@/lib/scheduling';
import { useSchedule, useViewer } from '@/lib/client/useSchedule';
import type { TaskItem } from '@/lib/types';
import { TaskFormModal, type FormRequest } from './TaskFormModal';
import { Button, cx } from './ui';
import { CalendarView } from './views/CalendarView';
import { GanttView } from './views/GanttView';
import { TableView } from './views/TableView';
import type { AddDefaults, ViewProps } from './views/types';

type View = 'gantt' | 'calendar' | 'table';
const VIEWS: { id: View; label: string }[] = [
  { id: 'gantt', label: 'Gantt' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'table', label: 'Table' },
];

function readViewFromUrl(): View {
  const v = new URLSearchParams(window.location.search).get('view');
  return v === 'calendar' || v === 'table' ? v : 'gantt';
}

export function AppShell() {
  const schedule = useSchedule();
  const viewer = useViewer();
  const canEdit = Boolean(viewer?.isAdmin);
  const [view, setView] = useState<View>('gantt');
  const [form, setForm] = useState<FormRequest | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setView(readViewFromUrl());
    const onPop = () => setView(readViewFromUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const switchView = (v: View) => {
    setView(v);
    const url = new URL(window.location.href);
    url.searchParams.set('view', v);
    window.history.pushState(null, '', url);
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const notify = useCallback((kind: 'ok' | 'error', text: string) => setToast({ kind, text }), []);

  const withToast = useCallback(
    <A extends unknown[]>(fn: (...args: A) => Promise<unknown>, ok?: string) =>
      async (...args: A) => {
        try {
          const r = await fn(...args);
          if (ok) notify('ok', ok);
          return r;
        } catch (e) {
          notify('error', (e as Error).message);
          throw e;
        }
      },
    [notify],
  );

  const onAdd = useCallback((defaults?: AddDefaults) => setForm({ mode: 'create', defaults }), []);
  const onOpen = useCallback((task: TaskItem) => setForm({ mode: 'edit', task }), []);
  const onDelete = useCallback(
    async (task: TaskItem) => {
      const n = descendants(buildHierarchy(schedule.tasks), task.id).length;
      const msg = n ? `Delete "${task.title}" and its ${n} subtask${n === 1 ? '' : 's'}? This can't be undone.` : `Delete "${task.title}"? This can't be undone.`;
      if (!window.confirm(msg)) return;
      await withToast(schedule.remove, 'Deleted')(task.id).catch(() => undefined);
    },
    [schedule.tasks, schedule.remove, withToast],
  );

  // Keyboard shortcut: "n" opens Quick-Add for admins.
  useEffect(() => {
    if (!canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !form && !/INPUT|TEXTAREA|SELECT/.test(target.tagName)) {
        e.preventDefault();
        onAdd();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canEdit, form, onAdd]);

  const viewProps: ViewProps = {
    tasks: schedule.tasks,
    canEdit,
    scheduleMode: schedule.mode,
    onOpen,
    onAdd,
    onUpdate: withToast(schedule.update),
    onDelete,
  };

  return (
    <div className="flex h-dvh flex-col bg-slate-50 text-slate-900">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="h-6 w-6 text-indigo-600" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            <rect x="3" y="4" width="18" height="17" rx="2" />
            <path d="M3 9h18M8 2v4M16 2v4M7 13h6M10 17h7" strokeLinecap="round" />
          </svg>
          <div className="leading-tight">
            <h1 className="text-sm font-semibold">Production Scheduler</h1>
            {schedule.projectStart && (
              <p className="text-[11px] text-slate-500">
                {schedule.projectStart} → {schedule.projectFinish} · {schedule.tasks.length} items
              </p>
            )}
          </div>
        </div>

        <nav aria-label="Views" className="order-3 flex w-full gap-1 sm:order-none sm:w-auto">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-current={view === v.id ? 'page' : undefined}
              onClick={() => switchView(v.id)}
              className={cx('flex-1 rounded-md px-3 py-1.5 text-sm font-medium sm:flex-none', view === v.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100')}
            >
              {v.label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {canEdit && (
            <Button variant="primary" onClick={() => onAdd()} title="Quick add (N)">
              <span aria-hidden>＋</span> Add
            </Button>
          )}
          <AuthControl viewer={viewer} />
        </div>
      </header>

      <main className="relative min-h-0 flex-1 bg-white">
        {schedule.loading ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading schedule…</div>
        ) : schedule.error && schedule.tasks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm">
            <p className="text-red-600">Couldn&apos;t load the schedule: {schedule.error}</p>
            <Button onClick={schedule.refresh}>Retry</Button>
          </div>
        ) : schedule.tasks.length === 0 && canEdit ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-slate-600">
            <p>The schedule is empty.</p>
            <Button variant="primary" onClick={() => onAdd()}>
              Add the first task
            </Button>
          </div>
        ) : view === 'gantt' ? (
          <GanttView {...viewProps} />
        ) : view === 'calendar' ? (
          <CalendarView {...viewProps} />
        ) : (
          <TableView {...viewProps} />
        )}
      </main>

      <TaskFormModal
        request={form}
        tasks={schedule.tasks}
        canEdit={canEdit}
        scheduleMode={schedule.mode}
        onClose={() => setForm(null)}
        onCreate={withToast(schedule.create, 'Added to schedule')}
        onUpdate={withToast(schedule.update, 'Saved')}
        onDelete={withToast(schedule.remove, 'Deleted')}
      />

      {toast && (
        <div role="status" className={cx('fixed bottom-4 left-1/2 z-[60] max-w-[90vw] -translate-x-1/2 rounded-md px-4 py-2 text-sm shadow-lg', toast.kind === 'ok' ? 'bg-slate-900 text-white' : 'bg-red-600 text-white')}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

function AuthControl({ viewer }: { viewer: ReturnType<typeof useViewer> }) {
  if (!viewer) return <span className="h-9 w-20 animate-pulse rounded-md bg-slate-100" />;
  if (viewer.devBypass) {
    return <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">Dev admin</span>;
  }
  if (!viewer.email) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 sm:inline">View only</span>
        {viewer.signInAvailable && <Button onClick={() => signIn('google')}>Sign in with Google</Button>}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {!viewer.isAdmin && <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">View only</span>}
      {viewer.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={viewer.image} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" />
      ) : null}
      <span className="hidden max-w-[12rem] truncate text-xs text-slate-600 md:inline">{viewer.email}</span>
      <Button size="sm" variant="ghost" onClick={() => signOut()}>
        Sign out
      </Button>
    </div>
  );
}
