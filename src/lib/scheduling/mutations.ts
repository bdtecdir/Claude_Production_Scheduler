/**
 * Pure mutation helpers shared by the API (authoritative writes) and the UI
 * (drag previews). Each returns a fully rescheduled task list, so callers
 * get cascading recalculation and cycle detection for free.
 */
import type { TaskDependency, TaskInput, TaskItem, TaskPatch } from '../types';
import { addDays, diffDays, endDateFor } from './dates';
import { schedule, type ScheduleOptions, type ScheduleResult } from './cpm';
import { buildHierarchy, descendants } from './hierarchy';
import { assertValidPatch, ValidationError } from './validate';

/** Make durations/end dates consistent with the task type. */
export function normalizeTask(t: TaskItem): TaskItem {
  const durationDays = t.type === 'milestone' ? 0 : Math.max(1, Math.round(t.durationDays || 1));
  return {
    ...t,
    durationDays,
    endDate: endDateFor(t.startDate, durationDays),
    dependencies: dedupeDependencies(t.dependencies ?? [], t.id),
    parentId: t.parentId || null,
    progressPercent: Math.min(100, Math.max(0, Math.round(t.progressPercent ?? 0))),
  };
}

function dedupeDependencies(deps: TaskDependency[], selfId: string): TaskDependency[] {
  const seen = new Set<string>();
  return deps.filter((d) => {
    if (d.predecessorId === selfId) return true; // let validation report it
    if (seen.has(d.predecessorId)) return false;
    seen.add(d.predecessorId);
    return true;
  });
}

export function buildTask(id: string, input: TaskInput, now: string): TaskItem {
  return normalizeTask({
    id,
    title: input.title.trim(),
    description: input.description?.trim() || '',
    type: input.type,
    startDate: input.startDate,
    endDate: input.startDate,
    durationDays: input.durationDays,
    progressPercent: input.progressPercent ?? 0,
    parentId: input.parentId ?? null,
    dependencies: input.dependencies ?? [],
    venueId: input.venueId ?? null,
    assignedPersonnelIds: input.assignedPersonnelIds ?? [],
    tags: input.tags ?? [],
    createdAt: now,
    updatedAt: now,
  });
}

export interface MutationResult extends ScheduleResult {
  /** Ids removed by the mutation (delete only). */
  deletedIds: string[];
}

export function createTask(
  tasks: readonly TaskItem[],
  task: TaskItem,
  opts?: ScheduleOptions,
): MutationResult {
  if (tasks.some((t) => t.id === task.id)) throw new ValidationError(`Task ${task.id} already exists`);
  const next = [...tasks, task];
  assertValidPatch(next, task.id);
  return withTarget(schedule(next, { ...opts, anchors: [task.id] }), task.id);
}

export function updateTask(
  tasks: readonly TaskItem[],
  id: string,
  patch: TaskPatch,
  now: string,
  opts?: ScheduleOptions,
): MutationResult {
  const current = tasks.find((t) => t.id === id);
  if (!current) throw new ValidationError(`Task ${id} was not found`);
  const merged = normalizeTask({
    ...current,
    ...stripUndefined(patch),
    title: patch.title !== undefined ? patch.title.trim() : current.title,
    id,
    updatedAt: now,
  });
  const next = tasks.map((t) => (t.id === id ? merged : t));
  assertValidPatch(next, id);
  return withTarget(schedule(next, { ...opts, anchors: [id] }), id);
}

/**
 * `schedule` diffs against its input, which already contains the edit, so
 * the edited task itself must always be marked for persistence.
 */
function withTarget(result: ScheduleResult, id: string): MutationResult {
  return { ...result, changedIds: [id, ...result.changedIds.filter((x) => x !== id)], deletedIds: [] };
}

/** Removes a task and its whole subtree, and strips links that point at them. */
export function deleteTask(
  tasks: readonly TaskItem[],
  id: string,
  now: string,
  opts?: ScheduleOptions,
): MutationResult {
  if (!tasks.some((t) => t.id === id)) throw new ValidationError(`Task ${id} was not found`);
  const h = buildHierarchy(tasks);
  const removed = new Set([id, ...descendants(h, id)]);
  const stripped: string[] = [];
  const next = tasks
    .filter((t) => !removed.has(t.id))
    .map((t) => {
      if (!t.dependencies.some((d) => removed.has(d.predecessorId))) return t;
      stripped.push(t.id);
      return { ...t, dependencies: t.dependencies.filter((d) => !removed.has(d.predecessorId)), updatedAt: now };
    });
  const result = schedule(next, opts);
  // Tasks whose links were stripped must be written even if dates didn't move.
  return {
    ...result,
    changedIds: [...new Set([...result.changedIds, ...stripped])],
    deletedIds: [...removed],
  };
}

export interface DuplicateOptions {
  /** Title for the copy of the group's top task. */
  title: string;
  /** Plain-text find/replace applied to every other copied title (e.g. "Hamlet" -> "Macbeth"). */
  rename?: { find: string; replace: string };
  /** Item inside the group whose new date positions the copy. */
  anchorId: string;
  anchorDate: string;
  /** Copy links to items outside the group (default: dropped). */
  keepExternalLinks?: boolean;
  /** Copy assigned people (default: kept). */
  keepAssignments?: boolean;
}

/** Tag that marks a group as a reusable template; copies don't inherit it. */
export const TEMPLATE_TAG = 'template';

/**
 * Copies a task and its whole subtree as a sibling of the original, shifted so
 * the anchor lands on `anchorDate`. Every item keeps its offset from the anchor;
 * links inside the group are rewired to the copies. Progress starts at 0.
 */
export function duplicateGroup(
  tasks: readonly TaskItem[],
  rootId: string,
  options: DuplicateOptions,
  newId: () => string,
  now: string,
  opts?: ScheduleOptions,
): MutationResult & { rootId: string } {
  if (!tasks.some((t) => t.id === rootId)) throw new ValidationError(`Task ${rootId} was not found`);
  // Use freshly rolled-up dates so a summary anchor has its real span.
  const current = schedule(tasks, opts).tasks;
  const h = buildHierarchy(current);
  const groupIds = [rootId, ...descendants(h, rootId)];
  if (!groupIds.includes(options.anchorId)) throw new ValidationError('The anchor must be inside the group being duplicated');
  const title = options.title.trim();
  if (!title) throw new ValidationError('Give the copy a name');

  const delta = diffDays(h.byId.get(options.anchorId)!.startDate, options.anchorDate);
  const idMap = new Map(groupIds.map((id) => [id, newId()]));
  const find = options.rename?.find.trim() ?? '';
  const baseTime = Date.parse(now);

  const copies = groupIds.map((id, i) => {
    const t = h.byId.get(id)!;
    const copyTitle = id === rootId ? title : find ? t.title.split(find).join(options.rename!.replace) : t.title;
    return normalizeTask({
      ...t,
      id: idMap.get(id)!,
      title: copyTitle.trim().slice(0, 200) || t.title,
      parentId: id === rootId ? (t.parentId ?? null) : idMap.get(t.parentId!)!,
      startDate: addDays(t.startDate, delta),
      progressPercent: 0,
      dependencies: t.dependencies
        .filter((d) => idMap.has(d.predecessorId) || options.keepExternalLinks)
        .map((d) => ({ ...d, predecessorId: idMap.get(d.predecessorId) ?? d.predecessorId })),
      assignedPersonnelIds: options.keepAssignments === false ? [] : (t.assignedPersonnelIds ?? []),
      tags: (t.tags ?? []).filter((tag) => tag.toLowerCase() !== TEMPLATE_TAG),
      isCritical: undefined,
      totalFloat: undefined,
      // Distinct, ordered timestamps keep sibling order identical to the original.
      createdAt: new Date(baseTime + i).toISOString(),
      updatedAt: now,
    });
  });

  const next = [...current, ...copies];
  for (const c of copies) assertValidPatch(next, c.id);
  const newIds = copies.map((c) => c.id);
  const result = schedule(next, { ...opts, anchors: newIds });
  return {
    ...result,
    changedIds: [...new Set([...newIds, ...result.changedIds])],
    deletedIds: [],
    rootId: idMap.get(rootId)!,
  };
}

/** Drag preview: move a leaf task so it starts `deltaDays` later. */
export function previewShift(tasks: readonly TaskItem[], id: string, deltaDays: number, opts?: ScheduleOptions) {
  const t = tasks.find((x) => x.id === id)!;
  return updateTask(tasks, id, { startDate: addDays(t.startDate, deltaDays) }, t.updatedAt, opts);
}

/** Drag preview: change start and/or duration of a leaf task. */
export function previewResize(
  tasks: readonly TaskItem[],
  id: string,
  startDate: string,
  durationDays: number,
  opts?: ScheduleOptions,
) {
  const t = tasks.find((x) => x.id === id)!;
  return updateTask(tasks, id, { startDate, durationDays }, t.updatedAt, opts);
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
