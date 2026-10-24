/**
 * Parent/subtask hierarchy helpers: tree construction, parent-cycle checks,
 * leaf expansion, display ordering and WBS codes.
 */
import type { TaskItem } from '../types';
import { CycleError } from './graph';

export interface Hierarchy {
  byId: Map<string, TaskItem>;
  /** Children per parent id, in display order. Roots are under `null`. */
  children: Map<string | null, TaskItem[]>;
  /** Effective parent id (null for roots and for orphans whose parent is missing). */
  parentOf: Map<string, string | null>;
}

/** Stable sibling order: creation time, then id. */
export function compareSiblings(a: TaskItem, b: TaskItem): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

export function buildHierarchy(tasks: readonly TaskItem[]): Hierarchy {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const parentOf = new Map<string, string | null>();
  const children = new Map<string | null, TaskItem[]>([[null, []]]);

  for (const t of tasks) {
    const parent = t.parentId && t.parentId !== t.id && byId.has(t.parentId) ? t.parentId : null;
    if (t.parentId === t.id) {
      throw new CycleError([t.id, t.id], (id) => byId.get(id)?.title ?? id);
    }
    parentOf.set(t.id, parent);
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(t);
  }
  for (const list of children.values()) list.sort(compareSiblings);

  // Parent chains must terminate at a root.
  for (const t of tasks) {
    const seen: string[] = [];
    let cur: string | null = t.id;
    while (cur) {
      if (seen.includes(cur)) {
        const cycle = [...seen.slice(seen.indexOf(cur)), cur];
        throw new CycleError(cycle, (id) => byId.get(id)?.title ?? id);
      }
      seen.push(cur);
      cur = parentOf.get(cur) ?? null;
    }
  }

  return { byId, children, parentOf };
}

export function isSummary(h: Hierarchy, id: string): boolean {
  return (h.children.get(id)?.length ?? 0) > 0;
}

/** All non-summary descendants of `id` (or [id] when it is itself a leaf). */
export function leafDescendants(h: Hierarchy, id: string): string[] {
  const kids = h.children.get(id);
  if (!kids?.length) return [id];
  return kids.flatMap((k) => leafDescendants(h, k.id));
}

export function ancestors(h: Hierarchy, id: string): string[] {
  const out: string[] = [];
  let cur = h.parentOf.get(id) ?? null;
  while (cur) {
    out.push(cur);
    cur = h.parentOf.get(cur) ?? null;
  }
  return out;
}

export function descendants(h: Hierarchy, id: string): string[] {
  return (h.children.get(id) ?? []).flatMap((k) => [k.id, ...descendants(h, k.id)]);
}

export interface TreeRow {
  task: TaskItem;
  depth: number;
  wbs: string;
  hasChildren: boolean;
}

/** Depth-first rows in display order with WBS codes ("1", "1.2", "1.2.3"). */
export function flattenTree(tasks: readonly TaskItem[], collapsed?: ReadonlySet<string>): TreeRow[] {
  const h = buildHierarchy(tasks);
  const rows: TreeRow[] = [];
  const walk = (parent: string | null, depth: number, prefix: string) => {
    (h.children.get(parent) ?? []).forEach((task, i) => {
      const wbs = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      const hasChildren = isSummary(h, task.id);
      rows.push({ task, depth, wbs, hasChildren });
      if (hasChildren && !collapsed?.has(task.id)) walk(task.id, depth + 1, wbs);
    });
  };
  walk(null, 0, '');
  return rows;
}

export function wbsCodes(tasks: readonly TaskItem[]): Map<string, string> {
  return new Map(flattenTree(tasks).map((r) => [r.task.id, r.wbs]));
}
