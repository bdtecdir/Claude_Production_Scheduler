/**
 * Critical Path Method scheduler.
 *
 * Time model: integer day numbers with an exclusive finish, i.e. a task
 * occupying days [S, F) has duration F - S. A milestone has S === F. The
 * persisted `endDate` is inclusive (F - 1 for tasks, S for milestones).
 *
 * Dependency constraints (successor s, predecessor p, lag L):
 *   FS: s.S >= p.F + L        SS: s.S >= p.S + L
 *   FF: s.F >= p.F + L        SF: s.F >= p.S + L
 *
 * Summary (parent) tasks are not scheduled directly: their span is the
 * bounding box of their subtasks. A dependency *on* a summary uses its
 * rolled-up dates; a dependency *of* a summary is inherited by every leaf
 * underneath it.
 *
 * Each leaf's stored startDate acts as a "start no earlier than" date, so a
 * predecessor slipping later pushes successors, while successors that were
 * deliberately scheduled later keep their position. With `mode: 'asap'` any
 * leaf that has predecessors is instead pulled to its earliest feasible date
 * (except tasks listed in `anchors`, typically the one the user just edited).
 */
import type { DependencyType, TaskDependency, TaskItem } from '../types';
import { fromDayNumber, toDayNumber } from './dates';
import { addEdge, topologicalSort, type AdjacencyList } from './graph';
import { buildHierarchy, isSummary, leafDescendants } from './hierarchy';

export interface ScheduleOptions {
  mode?: 'respect-dates' | 'asap';
  /** Task ids that keep their stored start date even in 'asap' mode. */
  anchors?: readonly string[];
}

export interface TaskAnalysis {
  earlyStart: string;
  earlyFinish: string;
  lateStart: string;
  lateFinish: string;
  totalFloat: number;
  isCritical: boolean;
  isSummary: boolean;
}

export interface ScheduleResult {
  /** Input tasks (same order) with dates, durations and CPM flags applied. */
  tasks: TaskItem[];
  analysis: Map<string, TaskAnalysis>;
  /** Ids whose dates, duration, progress or CPM flags differ from the input. */
  changedIds: string[];
  projectStart: string | null;
  projectFinish: string | null;
  /** Ids in the order they were scheduled (dependency order). */
  order: string[];
}

interface Link {
  successorId: string;
  dep: TaskDependency;
}

interface Node {
  es: number;
  ef: number;
  ls: number;
  lf: number;
  /** Summary only: latest allowed start/finish imposed on its subtasks. */
  startBound: number;
  finishBound: number;
}

function earliestStart(type: DependencyType, pred: Node, lag: number, duration: number): number {
  switch (type) {
    case 'FS':
      return pred.ef + lag;
    case 'SS':
      return pred.es + lag;
    case 'FF':
      return pred.ef + lag - duration;
    case 'SF':
      return pred.es + lag - duration;
  }
}

export function schedule(input: readonly TaskItem[], options: ScheduleOptions = {}): ScheduleResult {
  const mode = options.mode ?? 'respect-dates';
  const anchors = new Set(options.anchors ?? []);
  const h = buildHierarchy(input);
  const label = (id: string) => h.byId.get(id)?.title || id;
  const ids = input.map((t) => t.id);

  // Effective dependencies per leaf: own + inherited from every ancestor.
  const leafDeps = new Map<string, TaskDependency[]>();
  const succLinks = new Map<string, Link[]>();
  const graph: AdjacencyList = new Map(ids.map((id) => [id, new Set<string>()]));

  for (const t of input) {
    const parent = h.parentOf.get(t.id);
    if (parent) addEdge(graph, t.id, parent); // rollup: child before parent
    for (const dep of t.dependencies ?? []) {
      if (!h.byId.has(dep.predecessorId)) continue; // dangling links are ignored
      for (const leaf of leafDescendants(h, t.id)) {
        addEdge(graph, dep.predecessorId, leaf);
        if (!leafDeps.has(leaf)) leafDeps.set(leaf, []);
        leafDeps.get(leaf)!.push(dep);
        if (!succLinks.has(dep.predecessorId)) succLinks.set(dep.predecessorId, []);
        succLinks.get(dep.predecessorId)!.push({ successorId: leaf, dep });
      }
    }
  }

  const order = topologicalSort(ids, graph, label);
  const nodes = new Map<string, Node>();
  const duration = (id: string) => {
    const n = nodes.get(id);
    if (n) return n.ef - n.es;
    const t = h.byId.get(id)!;
    return t.type === 'milestone' ? 0 : Math.max(1, Math.round(t.durationDays || 1));
  };

  // ---- Forward pass -------------------------------------------------------
  for (const id of order) {
    const t = h.byId.get(id)!;
    if (isSummary(h, id)) {
      const kids = h.children.get(id)!.map((k) => nodes.get(k.id)!);
      const es = Math.min(...kids.map((k) => k.es));
      const ef = Math.max(...kids.map((k) => k.ef));
      nodes.set(id, { es, ef, ls: 0, lf: 0, startBound: Infinity, finishBound: Infinity });
      continue;
    }
    const dur = duration(id);
    const deps = leafDeps.get(id) ?? [];
    const pulled = mode === 'asap' && deps.length > 0 && !anchors.has(id);
    let es = pulled ? -Infinity : toDayNumber(t.startDate);
    for (const dep of deps) {
      const lag = Math.round(dep.lagDays || 0);
      es = Math.max(es, earliestStart(dep.type, nodes.get(dep.predecessorId)!, lag, dur));
    }
    nodes.set(id, { es, ef: es + dur, ls: 0, lf: 0, startBound: Infinity, finishBound: Infinity });
  }

  const leafIds = ids.filter((id) => !isSummary(h, id));
  const projectStartDay = leafIds.length ? Math.min(...leafIds.map((id) => nodes.get(id)!.es)) : null;
  const projectFinishDay = leafIds.length ? Math.max(...leafIds.map((id) => nodes.get(id)!.ef)) : null;

  // ---- Backward pass ------------------------------------------------------
  for (const id of [...order].reverse()) {
    const n = nodes.get(id)!;
    const dur = n.ef - n.es;
    let lf = projectFinishDay ?? n.ef;
    let ls = Infinity;
    for (const { successorId, dep } of succLinks.get(id) ?? []) {
      const s = nodes.get(successorId)!;
      const lag = Math.round(dep.lagDays || 0);
      if (dep.type === 'FS') lf = Math.min(lf, s.ls - lag);
      else if (dep.type === 'FF') lf = Math.min(lf, s.lf - lag);
      else if (dep.type === 'SS') ls = Math.min(ls, s.ls - lag);
      else ls = Math.min(ls, s.lf - lag); // SF
    }
    const parent = h.parentOf.get(id);
    if (parent) {
      const p = nodes.get(parent)!;
      lf = Math.min(lf, p.finishBound);
      // A summary's start is set by its earliest subtask(s) only.
      if (n.es === p.es) ls = Math.min(ls, p.startBound);
    }
    n.finishBound = lf;
    n.startBound = ls;
    n.lf = Math.min(lf, ls + dur);
    n.ls = n.lf - dur;
  }

  // ---- Float, rollups and output -----------------------------------------
  const floatOf = new Map<string, number>();
  const progressOf = new Map<string, { weighted: number; weight: number }>();
  for (const id of order) {
    const t = h.byId.get(id)!;
    const n = nodes.get(id)!;
    if (isSummary(h, id)) {
      const kids = h.children.get(id)!;
      floatOf.set(id, Math.min(...kids.map((k) => floatOf.get(k.id)!)));
      const agg = kids.reduce(
        (acc, k) => {
          const p = progressOf.get(k.id)!;
          return { weighted: acc.weighted + p.weighted, weight: acc.weight + p.weight };
        },
        { weighted: 0, weight: 0 },
      );
      progressOf.set(id, agg);
    } else {
      floatOf.set(id, n.ls - n.es);
      const weight = Math.max(1, n.ef - n.es);
      progressOf.set(id, { weighted: weight * clampProgress(t.progressPercent), weight });
    }
  }

  const analysis = new Map<string, TaskAnalysis>();
  const changedIds: string[] = [];
  const tasks = input.map((t) => {
    const n = nodes.get(t.id)!;
    const summary = isSummary(h, t.id);
    const totalFloat = floatOf.get(t.id)!;
    const isCritical = totalFloat <= 0;
    const dur = n.ef - n.es;
    const prog = progressOf.get(t.id)!;
    const next: TaskItem = {
      ...t,
      startDate: fromDayNumber(n.es),
      endDate: fromDayNumber(dur > 0 ? n.ef - 1 : n.es),
      durationDays: dur,
      progressPercent: summary ? Math.round(prog.weighted / prog.weight) : clampProgress(t.progressPercent),
      isCritical,
      totalFloat,
    };
    analysis.set(t.id, {
      earlyStart: fromDayNumber(n.es),
      earlyFinish: fromDayNumber(dur > 0 ? n.ef - 1 : n.es),
      lateStart: fromDayNumber(n.ls),
      lateFinish: fromDayNumber(dur > 0 ? n.lf - 1 : n.ls),
      totalFloat,
      isCritical,
      isSummary: summary,
    });
    if (
      next.startDate !== t.startDate ||
      next.endDate !== t.endDate ||
      next.durationDays !== t.durationDays ||
      next.progressPercent !== t.progressPercent ||
      next.isCritical !== t.isCritical ||
      next.totalFloat !== t.totalFloat
    ) {
      changedIds.push(t.id);
    }
    return next;
  });

  return {
    tasks,
    analysis,
    changedIds,
    projectStart: projectStartDay === null ? null : fromDayNumber(projectStartDay),
    // Latest inclusive end date (a closing milestone ends on its own day).
    projectFinish: leafIds.length
      ? tasks.reduce((max, t) => (t.endDate > max ? t.endDate : max), tasks[0].endDate)
      : null,
    order,
  };
}

function clampProgress(p: number | undefined): number {
  if (typeof p !== 'number' || Number.isNaN(p)) return 0;
  return Math.min(100, Math.max(0, Math.round(p)));
}

/** Convenience: ids on the critical path (leaf tasks only). */
export function criticalPath(result: ScheduleResult): string[] {
  return result.order.filter((id) => {
    const a = result.analysis.get(id)!;
    return a.isCritical && !a.isSummary;
  });
}
