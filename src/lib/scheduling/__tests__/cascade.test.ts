import { describe, expect, it } from 'vitest';
import { schedule } from '../cpm';
import { addDays, durationBetween, endDateFor, isIsoDate, toDayNumber, fromDayNumber } from '../dates';
import { topologicalSort, CycleError } from '../graph';
import { flattenTree } from '../hierarchy';
import { createTask, deleteTask, previewShift, updateTask, buildTask } from '../mutations';
import { parseTaskBody, ValidationError } from '../validate';
import { formatDependency } from '../format';
import { byId, dep, mk } from './fixtures';

const MON = '2026-01-05';
const NOW = '2026-02-01T00:00:00.000Z';

function chain() {
  return schedule([
    mk('A', MON, 3),
    mk('B', MON, 2, { dependencies: [dep('A')] }),
    mk('C', MON, 4, { dependencies: [dep('B', 'SS', 1)] }),
    mk('D', MON, 1, { dependencies: [dep('C', 'FF')] }),
    mk('E', '2026-03-01', 1),
  ]).tasks;
}

describe('date cascading', () => {
  it('extending a predecessor pushes the whole successor chain', () => {
    const before = byId(chain());
    const res = updateTask(chain(), 'A', { durationDays: 6 }, NOW);
    const after = byId(res.tasks);
    expect(after.B.startDate).toBe(addDays(before.B.startDate, 3));
    expect(after.C.startDate).toBe(addDays(before.C.startDate, 3));
    expect(after.D.endDate).toBe(addDays(before.D.endDate, 3));
    expect(after.E.startDate).toBe(before.E.startDate);
    expect(res.changedIds).toEqual(expect.arrayContaining(['A', 'B', 'C', 'D']));
    expect(res.changedIds).not.toContain('E');
  });

  it('always marks the edited task as changed so it gets persisted', () => {
    const moved = updateTask(chain(), 'A', { startDate: '2026-01-08' }, NOW);
    expect(moved.changedIds[0]).toBe('A');
    const renamed = updateTask(chain(), 'E', { title: 'Renamed' }, NOW);
    expect(renamed.changedIds).toEqual(['E']);
    const t = buildTask('N', { title: 'New', type: 'task', startDate: MON, durationDays: 1 }, NOW);
    expect(createTask(chain(), t).changedIds).toContain('N');
  });

  it('moving a predecessor later shifts successors by the same amount', () => {
    const res = previewShift(chain(), 'A', 5);
    const r = byId(res.tasks);
    expect(r.A.startDate).toBe('2026-01-10');
    expect(r.B.startDate).toBe('2026-01-13');
    expect(r.C.startDate).toBe('2026-01-14');
  });

  it('moving a predecessor earlier only pulls successors in asap mode', () => {
    const tasks = chain();
    const kept = byId(updateTask(tasks, 'A', { startDate: '2026-01-01' }, NOW).tasks);
    expect(kept.B.startDate).toBe('2026-01-08');
    const pulled = byId(updateTask(tasks, 'A', { startDate: '2026-01-01' }, NOW, { mode: 'asap' }).tasks);
    expect(pulled.B.startDate).toBe('2026-01-04');
    expect(pulled.C.startDate).toBe('2026-01-05');
  });

  it('converting a task to a milestone collapses its duration', () => {
    const r = byId(updateTask(chain(), 'A', { type: 'milestone' }, NOW).tasks);
    expect(r.A.durationDays).toBe(0);
    expect(r.A.endDate).toBe(r.A.startDate);
    expect(r.B.startDate).toBe('2026-01-08'); // keeps its date by default
    const pulled = byId(updateTask(chain(), 'A', { type: 'milestone' }, NOW, { mode: 'asap' }).tasks);
    expect(pulled.B.startDate).toBe(MON);
  });

  it('rejects an edit that would introduce a cycle', () => {
    expect(() => updateTask(chain(), 'A', { dependencies: [dep('D')] }, NOW)).toThrow(CycleError);
  });

  it('rejects unknown predecessors and self links on write', () => {
    expect(() => updateTask(chain(), 'A', { dependencies: [dep('nope')] }, NOW)).toThrow(ValidationError);
    expect(() => updateTask(chain(), 'A', { dependencies: [dep('A')] }, NOW)).toThrow(/itself/);
  });

  it('creating a subtask expands its parent', () => {
    const t = buildTask('A1', { title: 'Sub', type: 'task', startDate: '2026-01-06', durationDays: 10, parentId: 'A' }, NOW);
    const r = byId(createTask(chain(), t).tasks);
    expect(r.A.endDate).toBe('2026-01-15');
    expect(r.B.startDate).toBe('2026-01-16');
  });

  it('deleting a task removes its subtree and strips links to it', () => {
    const base = [...chain(), mk('A1', MON, 2, { parentId: 'A' })];
    const res = deleteTask(base, 'A', NOW);
    expect(res.deletedIds.sort()).toEqual(['A', 'A1']);
    const r = byId(res.tasks);
    expect(r.B.dependencies).toEqual([]);
    expect(res.changedIds).toContain('B');
  });
});

describe('topological sort', () => {
  it('orders nodes by dependency and is deterministic', () => {
    const g = new Map([
      ['c', new Set<string>()],
      ['a', new Set(['c'])],
      ['b', new Set(['c'])],
    ]);
    expect(topologicalSort(['c', 'b', 'a'], g)).toEqual(['b', 'a', 'c']);
  });

  it('throws on a cycle', () => {
    const g = new Map([
      ['a', new Set(['b'])],
      ['b', new Set(['a'])],
    ]);
    expect(() => topologicalSort(['a', 'b'], g)).toThrow(CycleError);
  });
});

describe('dates', () => {
  it('round-trips day numbers and handles leap years', () => {
    expect(fromDayNumber(toDayNumber('2028-02-29'))).toBe('2028-02-29');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(endDateFor(MON, 1)).toBe(MON);
    expect(endDateFor(MON, 0)).toBe(MON);
    expect(durationBetween(MON, '2026-01-09')).toBe(5);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-02-28')).toBe(true);
  });
});

describe('validation and formatting', () => {
  it('parses a valid create body and rejects bad input', () => {
    const ok = parseTaskBody(
      { title: 'Load-in', type: 'task', startDate: MON, durationDays: 2, dependencies: [{ predecessorId: 'x', type: 'SS' }] },
      false,
    );
    expect(ok.dependencies).toEqual([{ predecessorId: 'x', type: 'SS', lagDays: 0 }]);
    expect(() => parseTaskBody({ title: '', type: 'task', startDate: MON, durationDays: 1 }, false)).toThrow(ValidationError);
    expect(() => parseTaskBody({ dependencies: [{ predecessorId: 'x', type: 'XX' }] }, true)).toThrow(/FS, SS, FF, SF/);
    expect(() => parseTaskBody({ startDate: '2026-13-01' }, true)).toThrow(/startDate/);
    expect(() => parseTaskBody({ dependencies: [{ predecessorId: 'x', type: 'FS', lagDays: 1.5 }] }, true)).toThrow(/integer/);
  });

  it('formats WBS codes and dependency labels', () => {
    const tasks = chain();
    const rows = flattenTree([...tasks, mk('A1', MON, 1, { parentId: 'A' })]);
    const wbs = new Map(rows.map((r) => [r.task.id, r.wbs]));
    expect(wbs.get('A')).toBe('1');
    expect(wbs.get('A1')).toBe('1.1');
    expect(wbs.get('B')).toBe('2');
    expect(formatDependency(dep('A', 'FS', 2), wbs)).toBe('1FS+2d');
    expect(formatDependency(dep('B', 'SS', -1), wbs)).toBe('2SS-1d');
  });

  it('orders siblings by date, not creation order, and re-sorts when dates move', () => {
    const tasks = [
      mk('P', MON, 1),
      mk('opening', '2026-02-20', 0, { parentId: 'P' }), // created first
      mk('tech', '2026-02-14', 5, { parentId: 'P' }),
      mk('design', MON, 20, { parentId: 'P' }),
      mk('kickoff', '2026-02-14', 0, { parentId: 'P' }), // same start as tech: milestone first
    ];
    const order = (ts: typeof tasks) => flattenTree(ts).map((r) => r.task.id);
    expect(order(tasks)).toEqual(['P', 'design', 'kickoff', 'tech', 'opening']);
    const moved = updateTask(tasks, 'opening', { startDate: '2026-01-01' }, NOW).tasks;
    expect(order(moved).slice(0, 3)).toEqual(['P', 'opening', 'design']);
  });
});
