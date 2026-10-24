'use client';

import { useMemo, useState } from 'react';
import {
  addDays,
  buildHierarchy,
  dayOfWeek,
  descendants,
  diffDays,
  duplicateGroup,
  flattenTree,
  TEMPLATE_TAG,
  type ScheduleOptions,
} from '@/lib/scheduling';
import type { DuplicateBody } from '@/lib/scheduling/validate';
import type { TaskItem } from '@/lib/types';
import { Button, Diamond, Field, Modal, inputClass } from './ui';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PREVIEW_ROWS = 8;

interface Props {
  root: TaskItem | null;
  tasks: TaskItem[];
  scheduleMode: NonNullable<ScheduleOptions['mode']>;
  onClose: () => void;
  onDuplicate: (id: string, body: DuplicateBody) => Promise<unknown>;
}

export function DuplicateModal(props: Props) {
  if (!props.root) return null;
  return <DuplicateForm key={props.root.id} {...props} root={props.root} />;
}

function fmt(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** The group's "Opening Night"-style milestone, else its first milestone, else the group itself. */
function defaultAnchor(group: TaskItem[]): TaskItem {
  const milestones = group.filter((t) => t.type === 'milestone');
  return milestones.find((t) => /open/i.test(t.title)) ?? milestones[0] ?? group[0];
}

function DuplicateForm({ root, tasks, scheduleMode, onClose, onDuplicate }: Props & { root: TaskItem }) {
  // Group items in display order, with depth relative to the group's top task.
  const group = useMemo(() => {
    const ids = new Set([root.id, ...descendants(buildHierarchy(tasks), root.id)]);
    const rows = flattenTree(tasks).filter((r) => ids.has(r.task.id));
    const baseDepth = rows[0]?.depth ?? 0;
    return rows.map((r) => ({ task: r.task, depth: r.depth - baseDepth }));
  }, [tasks, root.id]);
  const groupTasks = group.map((g) => g.task);
  const initialAnchor = defaultAnchor(groupTasks);

  const [title, setTitle] = useState(`${root.title} (copy)`);
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [anchorId, setAnchorId] = useState(initialAnchor.id);
  const [anchorDate, setAnchorDate] = useState(initialAnchor.startDate);
  const [keepExternalLinks, setKeepExternalLinks] = useState(false);
  const [keepAssignments, setKeepAssignments] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const anchor = groupTasks.find((t) => t.id === anchorId) ?? initialAnchor;
  const groupIds = new Set(groupTasks.map((t) => t.id));
  const externalLinks = groupTasks.reduce((n, t) => n + t.dependencies.filter((d) => !groupIds.has(d.predecessorId)).length, 0);
  const hasAssignments = groupTasks.some((t) => (t.assignedPersonnelIds ?? []).length > 0);
  const isTemplate = (root.tags ?? []).some((t) => t.toLowerCase() === TEMPLATE_TAG);

  const body: DuplicateBody = {
    title,
    rename: find.trim() ? { find, replace } : undefined,
    anchorId,
    anchorDate,
    keepExternalLinks,
    keepAssignments,
  };

  // Dry-run through the same engine the server uses.
  const preview = useMemo(() => {
    try {
      let n = 0;
      const r = duplicateGroup(tasks, root.id, body, () => `__dup${n++}`, new Date().toISOString(), { mode: scheduleMode });
      const copies = flattenTree(r.tasks).filter((row) => row.task.id.startsWith('__dup'));
      const starts = copies.map((c) => c.task.startDate).sort();
      const ends = copies.map((c) => c.task.endDate).sort();
      return { copies, start: starts[0], end: ends[ends.length - 1], error: null };
    } catch (e) {
      return { copies: [], start: '', end: '', error: (e as Error).message };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, root.id, title, find, replace, anchorId, anchorDate, keepExternalLinks, keepAssignments, scheduleMode]);

  const shift = anchorDate ? diffDays(anchor.startDate, anchorDate) : 0;
  const weekdayChanged = anchorDate && dayOfWeek(anchorDate) !== dayOfWeek(anchor.startDate);
  // Nearest date to the one picked that falls on the anchor's original weekday.
  const sameWeekday = weekdayChanged
    ? (() => {
        const off = (((dayOfWeek(anchor.startDate) - dayOfWeek(anchorDate)) % 7) + 7) % 7;
        return addDays(anchorDate, off <= 3 ? off : off - 7);
      })()
    : null;

  const submit = async () => {
    if (preview.error || saving) return;
    setSaving(true);
    setSubmitError(null);
    try {
      await onDuplicate(root.id, body);
      onClose();
    } catch (e) {
      setSubmitError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      wide
      title={`Duplicate "${root.title}"`}
      onClose={onClose}
      footer={
        <div className="ml-auto flex items-center gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={saving || Boolean(preview.error)}>
            {saving ? 'Duplicating…' : `Create ${preview.copies.length} item${preview.copies.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Name of the copy">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
        </Field>

        {group.length > 1 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="In subtask names, replace" hint="Optional. Exact text, every occurrence.">
              <input className={inputClass} value={find} onChange={(e) => setFind(e.target.value)} placeholder="e.g. Hamlet" maxLength={200} />
            </Field>
            <Field label="with">
              <input className={inputClass} value={replace} onChange={(e) => setReplace(e.target.value)} placeholder="e.g. Macbeth" maxLength={200} disabled={!find.trim()} />
            </Field>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Anchor" hint={`Currently ${fmt(anchor.startDate)}`}>
            <select
              className={inputClass}
              value={anchorId}
              onChange={(e) => {
                const next = groupTasks.find((t) => t.id === e.target.value)!;
                // Carry the chosen shift over to the new anchor.
                setAnchorDate(addDays(next.startDate, shift));
                setAnchorId(next.id);
              }}
            >
              {group.map(({ task, depth }) => (
                <option key={task.id} value={task.id}>
                  {'  '.repeat(depth)}
                  {task.type === 'milestone' ? '◆ ' : ''}
                  {task.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="New date for the anchor" hint={shift ? `Everything moves ${Math.abs(shift)} day${Math.abs(shift) === 1 ? '' : 's'} ${shift > 0 ? 'later' : 'earlier'}` : 'Same dates as the original'}>
            <input type="date" className={inputClass} value={anchorDate} onChange={(e) => e.target.value && setAnchorDate(e.target.value)} required />
          </Field>
        </div>

        {weekdayChanged && sameWeekday && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
            <span>
              The anchor moves from a {WEEKDAYS[dayOfWeek(anchor.startDate)]} to a {WEEKDAYS[dayOfWeek(anchorDate)]}, so every item lands on a different weekday.
            </span>
            <Button size="sm" onClick={() => setAnchorDate(sameWeekday)}>
              Use {fmt(sameWeekday)}
            </Button>
          </div>
        )}

        {(externalLinks > 0 || hasAssignments) && (
          <div className="space-y-2">
            {hasAssignments && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={keepAssignments} onChange={(e) => setKeepAssignments(e.target.checked)} className="rounded border-slate-300 text-indigo-600" />
                Keep assigned people (you can change individual tasks afterwards)
              </label>
            )}
            {externalLinks > 0 && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={keepExternalLinks} onChange={(e) => setKeepExternalLinks(e.target.checked)} className="rounded border-slate-300 text-indigo-600" />
                Keep {externalLinks} link{externalLinks === 1 ? '' : 's'} to items outside this group
              </label>
            )}
          </div>
        )}

        {preview.error ? (
          <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200">
            {preview.error}
          </div>
        ) : (
          <div className="rounded-md ring-1 ring-inset ring-slate-200">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <span className="font-medium text-slate-800">Preview</span>
              <span>
                {preview.copies.length} item{preview.copies.length === 1 ? '' : 's'} · {fmt(preview.start)} → {fmt(preview.end)}
              </span>
            </div>
            <ul className="divide-y divide-slate-100 text-sm">
              {preview.copies.slice(0, PREVIEW_ROWS).map(({ task }, i) => (
                <li key={task.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <span className="flex min-w-0 items-center gap-1.5 truncate" style={{ paddingLeft: `${group[i]?.depth ?? 0}rem` }}>
                    {task.type === 'milestone' && <Diamond />}
                    <span className={task.id === preview.copies[0].task.id ? 'truncate font-medium' : 'truncate'}>{task.title}</span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">{task.type === 'milestone' ? fmt(task.startDate) : `${task.startDate} → ${task.endDate}`}</span>
                </li>
              ))}
              {preview.copies.length > PREVIEW_ROWS && <li className="px-3 py-1.5 text-xs text-slate-500">…and {preview.copies.length - PREVIEW_ROWS} more</li>}
            </ul>
          </div>
        )}

        <p className="text-[11px] text-slate-500">
          The copy is placed next to the original with progress reset to 0%.{' '}
          {isTemplate
            ? 'This group is tagged "template"; the copy won’t be.'
            : 'Tip: keep a clean master and tag it "template". Copies made from it don’t inherit the tag.'}
        </p>
        {submitError && (
          <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200">
            {submitError}
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
