import { describe, expect, it } from 'vitest';
import { schedule, criticalPath } from '../cpm';
import { CycleError } from '../graph';
import { byId, dep, mk } from './fixtures';

const MON = '2026-01-05';

describe('forward pass – dependency types', () => {
  it('FS: successor starts the day after the predecessor finishes', () => {
    const r = byId(
      schedule([mk('A', MON, 3), mk('B', MON, 2, { dependencies: [dep('A')] })]).tasks,
    );
    expect(r.A.endDate).toBe('2026-01-07');
    expect(r.B.startDate).toBe('2026-01-08');
    expect(r.B.endDate).toBe('2026-01-09');
  });

  it('FS with positive and negative lag', () => {
    const r = byId(
      schedule([
        mk('A', MON, 3),
        mk('B', MON, 1, { dependencies: [dep('A', 'FS', 2)] }),
        mk('C', MON, 1, { dependencies: [dep('A', 'FS', -1)] }),
      ]).tasks,
    );
    expect(r.B.startDate).toBe('2026-01-10');
    expect(r.C.startDate).toBe('2026-01-07');
  });

  it('SS: successor starts with the predecessor (plus lag)', () => {
    const r = byId(
      schedule([mk('A', '2026-01-10', 5), mk('B', MON, 2, { dependencies: [dep('A', 'SS', 1)] })]).tasks,
    );
    expect(r.B.startDate).toBe('2026-01-11');
  });

  it('FF: successor finishes with the predecessor', () => {
    const r = byId(
      schedule([mk('A', MON, 5), mk('B', MON, 2, { dependencies: [dep('A', 'FF')] })]).tasks,
    );
    expect(r.A.endDate).toBe('2026-01-09');
    expect(r.B.endDate).toBe('2026-01-09');
    expect(r.B.startDate).toBe('2026-01-08');
  });

  it('SF: successor finishes when the predecessor starts', () => {
    const r = byId(
      schedule([mk('A', '2026-01-10', 5), mk('B', MON, 2, { dependencies: [dep('A', 'SF')] })]).tasks,
    );
    // B must finish (exclusive) no earlier than A's start → occupies Jan 8–9.
    expect(r.B.startDate).toBe('2026-01-08');
    expect(r.B.endDate).toBe('2026-01-09');
  });

  it('takes the latest of several constraints', () => {
    const r = byId(
      schedule([
        mk('A', MON, 2),
        mk('B', MON, 6),
        mk('C', MON, 1, { dependencies: [dep('A'), dep('B')] }),
      ]).tasks,
    );
    expect(r.C.startDate).toBe('2026-01-11');
  });

  it('milestones have zero duration and start/end on the same day', () => {
    const r = byId(
      schedule([mk('A', MON, 3), mk('M', MON, 0, { dependencies: [dep('A')] })]).tasks,
    );
    expect(r.M.type).toBe('milestone');
    expect(r.M.durationDays).toBe(0);
    expect(r.M.startDate).toBe('2026-01-08');
    expect(r.M.endDate).toBe('2026-01-08');
  });

  it('project finish includes a closing milestone', () => {
    const res = schedule([mk('A', MON, 3), mk('M', MON, 0, { dependencies: [dep('A')] })]);
    expect(res.projectFinish).toBe('2026-01-08');
  });
});

describe('backward pass – float and critical path', () => {
  it('flags the longest path as critical and computes float on the short one', () => {
    const res = schedule([
      mk('A', MON, 5),
      mk('B', MON, 2),
      mk('C', MON, 3, { dependencies: [dep('A'), dep('B')] }),
    ]);
    const r = byId(res.tasks);
    expect(r.A.isCritical).toBe(true);
    expect(r.C.isCritical).toBe(true);
    expect(r.B.isCritical).toBe(false);
    expect(r.B.totalFloat).toBe(3);
    expect(res.analysis.get('B')!.lateStart).toBe('2026-01-08');
    expect(res.projectFinish).toBe('2026-01-12');
    expect(criticalPath(res)).toEqual(['A', 'C']);
  });

  it('computes float through SS and FF links', () => {
    // A(10) is the long pole. B(2) SS+1 on A has float; D(3) FF on A ends with A.
    const r = byId(
      schedule([
        mk('A', MON, 10),
        mk('B', MON, 2, { dependencies: [dep('A', 'SS', 1)] }),
        mk('D', MON, 3, { dependencies: [dep('A', 'FF')] }),
      ]).tasks,
    );
    expect(r.B.totalFloat).toBe(7);
    expect(r.D.totalFloat).toBe(0);
    expect(r.D.isCritical).toBe(true);
  });

  it('an SS successor that drives the finish keeps its predecessor critical', () => {
    const r = byId(
      schedule([mk('A', MON, 2), mk('B', MON, 10, { dependencies: [dep('A', 'SS')] })]).tasks,
    );
    expect(r.B.isCritical).toBe(true);
    expect(r.A.isCritical).toBe(true);
    expect(r.A.totalFloat).toBe(0);
  });

  it('a manually delayed successor gives its predecessor free float', () => {
    const r = byId(
      schedule([mk('A', MON, 2), mk('B', '2026-01-12', 2, { dependencies: [dep('A')] })]).tasks,
    );
    expect(r.B.startDate).toBe('2026-01-12');
    expect(r.A.totalFloat).toBe(5);
    expect(r.B.isCritical).toBe(true);
  });
});

describe('cycle detection', () => {
  it('throws a readable CycleError naming the loop', () => {
    const tasks = [
      mk('A', MON, 1, { title: 'Design', dependencies: [dep('C')] }),
      mk('B', MON, 1, { title: 'Build', dependencies: [dep('A')] }),
      mk('C', MON, 1, { title: 'Test', dependencies: [dep('B')] }),
    ];
    expect(() => schedule(tasks)).toThrow(CycleError);
    try {
      schedule(tasks);
    } catch (e) {
      const err = e as CycleError;
      expect(err.message).toMatch(/Circular dependency detected/);
      expect(err.cycle[0]).toBe(err.cycle[err.cycle.length - 1]);
      expect(new Set(err.cycle)).toEqual(new Set(['A', 'B', 'C']));
      expect(err.message).toContain('Design');
    }
  });

  it('detects a self-referencing dependency', () => {
    expect(() => schedule([mk('A', MON, 1, { dependencies: [dep('A')] })])).toThrow(CycleError);
  });

  it('detects a subtask that depends on its own parent', () => {
    const tasks = [
      mk('P', MON, 1),
      mk('c1', MON, 2, { parentId: 'P', dependencies: [dep('P')] }),
    ];
    expect(() => schedule(tasks)).toThrow(CycleError);
  });

  it('detects parent/child loops', () => {
    const tasks = [mk('A', MON, 1, { parentId: 'B' }), mk('B', MON, 1, { parentId: 'A' })];
    expect(() => schedule(tasks)).toThrow(CycleError);
  });

  it('ignores dangling predecessor ids', () => {
    const r = byId(schedule([mk('A', MON, 2, { dependencies: [dep('missing')] })]).tasks);
    expect(r.A.startDate).toBe(MON);
  });
});

describe('hierarchy rollup', () => {
  it('parent spans the bounding box of its subtasks', () => {
    const r = byId(
      schedule([
        mk('P', '2025-12-01', 1, { title: 'Phase 1' }),
        mk('c1', MON, 3, { parentId: 'P' }),
        mk('c2', '2026-01-10', 2, { parentId: 'P' }),
      ]).tasks,
    );
    expect(r.P.startDate).toBe(MON);
    expect(r.P.endDate).toBe('2026-01-11');
    expect(r.P.durationDays).toBe(7);
  });

  it('rolls up through multiple levels and weights progress by duration', () => {
    const r = byId(
      schedule([
        mk('root', MON, 1),
        mk('mid', MON, 1, { parentId: 'root' }),
        mk('leaf1', MON, 3, { parentId: 'mid', progressPercent: 100 }),
        mk('leaf2', MON, 1, { parentId: 'mid', progressPercent: 0 }),
        mk('leaf3', '2026-01-20', 1, { parentId: 'root' }),
      ]).tasks,
    );
    expect(r.mid.endDate).toBe('2026-01-07');
    expect(r.root.endDate).toBe('2026-01-20');
    expect(r.mid.progressPercent).toBe(75);
  });

  it('a task can depend on a summary task', () => {
    const r = byId(
      schedule([
        mk('P', MON, 1),
        mk('c1', MON, 3, { parentId: 'P' }),
        mk('c2', MON, 5, { parentId: 'P' }),
        mk('X', MON, 1, { dependencies: [dep('P')] }),
      ]).tasks,
    );
    expect(r.X.startDate).toBe('2026-01-10');
    expect(r.c2.isCritical).toBe(true);
    expect(r.c1.isCritical).toBe(false);
    expect(r.c1.totalFloat).toBe(2);
  });

  it("a summary's own predecessors are inherited by its subtasks", () => {
    const r = byId(
      schedule([
        mk('A', MON, 4),
        mk('P', MON, 1, { dependencies: [dep('A')] }),
        mk('c1', MON, 2, { parentId: 'P' }),
        mk('c2', '2026-01-12', 2, { parentId: 'P' }),
      ]).tasks,
    );
    expect(r.c1.startDate).toBe('2026-01-09');
    expect(r.c2.startDate).toBe('2026-01-12');
    expect(r.P.startDate).toBe('2026-01-09');
    expect(r.P.endDate).toBe('2026-01-13');
  });

  it('summary float is the minimum float of its subtasks', () => {
    const r = byId(
      schedule([
        mk('A', MON, 10),
        mk('P', MON, 1),
        mk('c1', MON, 2, { parentId: 'P' }),
        mk('c2', MON, 4, { parentId: 'P' }),
      ]).tasks,
    );
    expect(r.c2.totalFloat).toBe(6);
    expect(r.P.totalFloat).toBe(6);
    expect(r.P.isCritical).toBe(false);
  });
});

describe('modes', () => {
  it("'asap' pulls successors back to their earliest date, 'respect-dates' does not", () => {
    const tasks = [mk('A', MON, 2), mk('B', '2026-01-20', 2, { dependencies: [dep('A')] })];
    expect(byId(schedule(tasks).tasks).B.startDate).toBe('2026-01-20');
    expect(byId(schedule(tasks, { mode: 'asap' }).tasks).B.startDate).toBe('2026-01-07');
    expect(byId(schedule(tasks, { mode: 'asap', anchors: ['B'] }).tasks).B.startDate).toBe('2026-01-20');
  });

  it('reports changed ids', () => {
    const tasks = [mk('A', MON, 2), mk('B', MON, 2, { dependencies: [dep('A')] }), mk('Z', MON, 9)];
    const first = schedule(tasks);
    expect(first.changedIds).toContain('B');
    const second = schedule(first.tasks);
    expect(second.changedIds).toEqual([]);
  });
});
