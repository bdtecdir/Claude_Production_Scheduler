'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ancestors,
  buildHierarchy,
  buildTask,
  createTask,
  descendants,
  durationBetween,
  endDateFor,
  flattenTree,
  isSummary,
  todayIso,
  updateTask,
  type ScheduleOptions,
} from '@/lib/scheduling';
import { DEPENDENCY_LABELS, DEPENDENCY_TYPES, type TaskDependency, type TaskInput, type TaskItem, type TaskKind } from '@/lib/types';
import { Button, CriticalBadge, Field, Modal, Segmented, inputClass } from './ui';

export type FormRequest =
  | { mode: 'create'; defaults?: { startDate?: string; parentId?: string | null; type?: TaskKind } }
  | { mode: 'edit'; task: TaskItem };

interface Props {
  request: FormRequest | null;
  tasks: TaskItem[];
  canEdit: boolean;
  scheduleMode: NonNullable<ScheduleOptions['mode']>;
  onClose: () => void;
  onCreate: (input: TaskInput) => Promise<unknown>;
  onUpdate: (id: string, patch: Partial<TaskInput>) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}

interface FormState {
  type: TaskKind;
  title: string;
  description: string;
  parentId: string;
  startDate: string;
  durationDays: number;
  progressPercent: number;
  tags: string;
  dependencies: TaskDependency[];
}

function initialState(req: FormRequest): FormState {
  if (req.mode === 'edit') {
    const t = req.task;
    return {
      type: t.type,
      title: t.title,
      description: t.description ?? '',
      parentId: t.parentId ?? '',
      startDate: t.startDate,
      durationDays: t.type === 'milestone' ? 1 : t.durationDays,
      progressPercent: t.progressPercent,
      tags: (t.tags ?? []).join(', '),
      dependencies: t.dependencies.map((d) => ({ ...d })),
    };
  }
  return {
    type: req.defaults?.type ?? 'task',
    title: '',
    description: '',
    parentId: req.defaults?.parentId ?? '',
    startDate: req.defaults?.startDate ?? todayIso(),
    durationDays: 1,
    progressPercent: 0,
    tags: '',
    dependencies: [],
  };
}

function toInput(f: FormState): TaskInput {
  return {
    type: f.type,
    title: f.title.trim(),
    description: f.description.trim(),
    parentId: f.parentId || null,
    startDate: f.startDate,
    durationDays: f.type === 'milestone' ? 0 : Math.max(1, Math.round(f.durationDays || 1)),
    progressPercent: f.progressPercent,
    tags: f.tags.split(',').map((s) => s.trim()).filter(Boolean),
    dependencies: f.dependencies.filter((d) => d.predecessorId),
  };
}

export function TaskFormModal(props: Props) {
  const { request } = props;
  if (!request) return null;
  const key = request.mode === 'edit' ? `edit-${request.task.id}` : `create-${JSON.stringify(request.defaults ?? {})}`;
  return <TaskForm key={key} {...props} request={request} />;
}

function TaskForm({ request, tasks, canEdit, scheduleMode, onClose, onCreate, onUpdate, onDelete }: Props & { request: FormRequest }) {
  const [form, setForm] = useState<FormState>(() => initialState(request));
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const editing = request.mode === 'edit' ? request.task : null;
  const readOnly = !canEdit;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const hierarchy = useMemo(() => buildHierarchy(tasks), [tasks]);
  const rows = useMemo(() => flattenTree(tasks), [tasks]);
  const summary = editing ? isSummary(hierarchy, editing.id) : false;

  // A task may not be parented under, or linked to, itself or its subtree.
  const excludedParents = useMemo(
    () => (editing ? new Set([editing.id, ...descendants(hierarchy, editing.id)]) : new Set<string>()),
    [editing, hierarchy],
  );
  const excludedPredecessors = useMemo(() => {
    if (!editing) return new Set<string>(form.parentId ? [form.parentId, ...ancestors(hierarchy, form.parentId)] : []);
    return new Set([editing.id, ...descendants(hierarchy, editing.id), ...ancestors(hierarchy, editing.id)]);
  }, [editing, hierarchy, form.parentId]);

  // Dry-run the change through the same engine the server uses.
  const preview = useMemo(() => {
    if (readOnly || !form.title.trim() || !form.startDate) return null;
    try {
      const input = toInput(form);
      const opts = { mode: scheduleMode };
      if (editing) {
        const r = updateTask(tasks, editing.id, input, editing.updatedAt, opts);
        return { task: r.tasks.find((t) => t.id === editing.id)!, cascaded: r.changedIds.filter((id) => id !== editing.id).length, error: null };
      }
      const draft = buildTask('__draft__', input, new Date().toISOString());
      const r = createTask(tasks, draft, opts);
      return { task: r.tasks.find((t) => t.id === draft.id)!, cascaded: 0, error: null };
    } catch (e) {
      return { task: null, cascaded: 0, error: (e as Error).message };
    }
  }, [form, tasks, editing, readOnly, scheduleMode]);

  const submit = async () => {
    if (readOnly || preview?.error) return;
    if (!form.title.trim()) {
      setSubmitError('Give it a title.');
      return;
    }
    setSaving(true);
    setSubmitError(null);
    try {
      const input = toInput(form);
      if (editing) {
        // Summary dates are rolled up; don't send them.
        const { startDate, durationDays, progressPercent, ...rest } = input;
        await onUpdate(editing.id, summary ? rest : { ...rest, startDate, durationDays, progressPercent });
      } else {
        await onCreate(input);
      }
      onClose();
    } catch (e) {
      setSubmitError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    const subtree = descendants(hierarchy, editing.id).length;
    const msg = subtree
      ? `Delete "${editing.title}" and its ${subtree} subtask${subtree === 1 ? '' : 's'}? This can't be undone.`
      : `Delete "${editing.title}"? This can't be undone.`;
    if (!window.confirm(msg)) return;
    setSaving(true);
    try {
      await onDelete(editing.id);
      onClose();
    } catch (e) {
      setSubmitError((e as Error).message);
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const title = readOnly ? 'Details' : editing ? `Edit ${editing.type}` : form.parentId ? 'Add subtask' : 'Add to schedule';
  const endDate = endDateFor(form.startDate, form.type === 'milestone' ? 0 : form.durationDays);
  const datesLocked = readOnly || summary;
  const scheduled = preview?.task;
  const moved = scheduled && scheduled.startDate !== form.startDate && !summary;

  return (
    <Modal
      open
      wide
      title={title}
      onClose={onClose}
      footer={
        <>
          {editing && canEdit && (
            <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={remove} disabled={saving}>
              Delete
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</Button>
            {!readOnly && (
              <Button variant="primary" onClick={submit} disabled={saving || Boolean(preview?.error)}>
                {saving ? 'Saving…' : editing ? 'Save changes' : form.type === 'milestone' ? 'Add milestone' : 'Add task'}
              </Button>
            )}
          </div>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            label="Item type"
            value={form.type}
            onChange={(v) => !readOnly && !summary && set('type', v)}
            options={[
              { value: 'task', label: 'Task' },
              { value: 'milestone', label: '◆ Milestone' },
            ]}
          />
          {editing && <CriticalBadge critical={editing.isCritical} float={editing.totalFloat} />}
        </div>

        <Field label="Title">
          <input className={inputClass} value={form.title} onChange={(e) => set('title', e.target.value)} disabled={readOnly} placeholder={form.type === 'milestone' ? 'e.g. Opening night' : 'e.g. Set construction'} maxLength={200} required />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Parent task">
            <select className={inputClass} value={form.parentId} onChange={(e) => set('parentId', e.target.value)} disabled={readOnly}>
              <option value="">— None (top level) —</option>
              {rows
                .filter((r) => !excludedParents.has(r.task.id) && r.task.type !== 'milestone')
                .map((r) => (
                  <option key={r.task.id} value={r.task.id}>
                    {'  '.repeat(r.depth)}
                    {r.wbs} {r.task.title}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Tags" hint="Comma separated">
            <input className={inputClass} value={form.tags} onChange={(e) => set('tags', e.target.value)} disabled={readOnly} placeholder="lighting, vendor" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label={form.type === 'milestone' ? 'Date' : 'Start'} className="col-span-2 sm:col-span-1">
            <input type="date" className={inputClass} value={form.startDate} onChange={(e) => e.target.value && set('startDate', e.target.value)} disabled={datesLocked} required />
          </Field>
          {form.type === 'task' && (
            <>
              <Field label="Finish" className="col-span-2 sm:col-span-1">
                <input
                  type="date"
                  className={inputClass}
                  value={endDate}
                  min={form.startDate}
                  onChange={(e) => e.target.value && set('durationDays', Math.max(1, durationBetween(form.startDate, e.target.value)))}
                  disabled={datesLocked}
                />
              </Field>
              <Field label="Duration (days)">
                <input type="number" min={1} max={3650} className={inputClass} value={form.durationDays} onChange={(e) => set('durationDays', Math.max(1, Number(e.target.value) || 1))} disabled={datesLocked} />
              </Field>
              <Field label={`Progress ${form.progressPercent}%`}>
                <input type="range" min={0} max={100} step={5} className="mt-2 w-full accent-indigo-600" value={form.progressPercent} onChange={(e) => set('progressPercent', Number(e.target.value))} disabled={datesLocked} />
              </Field>
            </>
          )}
        </div>
        {summary && <p className="-mt-2 text-xs text-slate-500">Dates, duration and progress roll up from this task&apos;s subtasks.</p>}

        <fieldset>
          <legend className="mb-1 flex w-full items-center justify-between text-xs font-medium text-slate-600">
            <span>Predecessors</span>
            {!readOnly && (
              <Button size="sm" variant="ghost" onClick={() => set('dependencies', [...form.dependencies, { predecessorId: '', type: 'FS', lagDays: 0 }])}>
                + Add predecessor
              </Button>
            )}
          </legend>
          {form.dependencies.length === 0 && <p className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500">No predecessors. This item is scheduled from its own start date.</p>}
          <div className="space-y-2">
            {form.dependencies.map((d, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2">
                <select
                  aria-label="Predecessor task"
                  className={inputClass}
                  value={d.predecessorId}
                  disabled={readOnly}
                  onChange={(e) => set('dependencies', form.dependencies.map((x, j) => (j === i ? { ...x, predecessorId: e.target.value } : x)))}
                >
                  <option value="">Select a task…</option>
                  {rows
                    .filter((r) => !excludedPredecessors.has(r.task.id))
                    .map((r) => (
                      <option key={r.task.id} value={r.task.id} disabled={form.dependencies.some((x, j) => j !== i && x.predecessorId === r.task.id)}>
                        {r.wbs} {r.task.title}
                      </option>
                    ))}
                </select>
                <select
                  aria-label="Dependency type"
                  className={`${inputClass} w-20`}
                  value={d.type}
                  disabled={readOnly}
                  title={DEPENDENCY_LABELS[d.type]}
                  onChange={(e) => set('dependencies', form.dependencies.map((x, j) => (j === i ? { ...x, type: e.target.value as TaskDependency['type'] } : x)))}
                >
                  {DEPENDENCY_TYPES.map((t) => (
                    <option key={t} value={t} title={DEPENDENCY_LABELS[t]}>
                      {t}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-1">
                  <input
                    aria-label="Lag in days"
                    type="number"
                    step={1}
                    className={`${inputClass} w-16`}
                    value={d.lagDays}
                    disabled={readOnly}
                    onChange={(e) => set('dependencies', form.dependencies.map((x, j) => (j === i ? { ...x, lagDays: Math.trunc(Number(e.target.value) || 0) } : x)))}
                  />
                  <span className="whitespace-nowrap text-xs text-slate-500">d lag</span>
                </div>
                {!readOnly ? (
                  <button type="button" aria-label="Remove predecessor" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600" onClick={() => set('dependencies', form.dependencies.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
          {form.dependencies.length > 0 && (
            <p className="mt-1 text-[11px] text-slate-500">FS finish→start · SS start→start · FF finish→finish · SF start→finish. Negative lag = lead.</p>
          )}
        </fieldset>

        <Field label="Notes">
          <textarea className={`${inputClass} min-h-[64px]`} value={form.description} onChange={(e) => set('description', e.target.value)} disabled={readOnly} maxLength={5000} />
        </Field>

        {!readOnly && preview?.error && (
          <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200">
            {preview.error}
          </div>
        )}
        {!readOnly && !preview?.error && scheduled && (moved || preview.cascaded > 0) && (
          <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
            {moved && (
              <>
                Predecessors push this to <strong>{scheduled.startDate}</strong>
                {scheduled.type === 'task' && <> → {scheduled.endDate}</>}.{' '}
              </>
            )}
            {preview.cascaded > 0 && <>Saving will reschedule {preview.cascaded} other item{preview.cascaded === 1 ? '' : 's'}.</>}
          </div>
        )}
        {submitError && (
          <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200">
            {submitError}
          </div>
        )}
        {editing && (
          <p className="text-[11px] text-slate-400">
            Last updated {new Date(editing.updatedAt).toLocaleString()} · ID {editing.id}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
