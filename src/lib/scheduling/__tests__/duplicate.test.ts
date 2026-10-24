import { describe, expect, it } from 'vitest';
import { schedule } from '../cpm';
import { diffDays } from '../dates';
import { buildHierarchy, descendants, flattenTree } from '../hierarchy';
import { duplicateGroup } from '../mutations';
import { ValidationError } from '../validate';
import { dep, mk } from './fixtures';

const NOW = '2026-02-01T00:00:00.000Z';

/** A small production: summary with a phase, tasks and an Opening Night milestone. */
function production() {
  return schedule([
    mk('P', '2026-03-01', 1, { title: 'Hamlet 2026', tags: ['template', 'theatre'] }),
    mk('build', '2026-03-01', 1, { title: 'Hamlet build', parentId: 'P' }),
    mk('set', '2026-03-02', 10, { title: 'Hamlet set construction', parentId: 'build', progressPercent: 60, assignedPersonnelIds: ['ana'] }),
    mk('paint', '2026-03-02', 4, { title: 'Scenic paint', parentId: 'build', dependencies: [dep('set')] }),
    mk('tech', '2026-03-20', 5, { title: 'Tech week', parentId: 'P', dependencies: [dep('paint'), dep('venue')] }),
    mk('open', '2026-03-27', 0, { title: 'Opening Night', parentId: 'P', dependencies: [dep('tech')] }),
    mk('venue', '2026-02-20', 3, { title: 'Venue booking' }),
  ]).tasks;
}

function ids() {
  let n = 0;
  return () => `new${++n}`;
}

const base = { title: 'Macbeth 2027', anchorId: 'open', anchorDate: '2027-03-26' };

describe('duplicateGroup', () => {
  it('copies the whole subtree, keeping every offset from the anchor', () => {
    const before = production();
    const res = duplicateGroup(before, 'P', base, ids(), NOW);
    const h = buildHierarchy(res.tasks);
    const copyIds = [res.rootId, ...descendants(h, res.rootId)];
    expect(copyIds).toHaveLength(6);
    expect(h.byId.get(res.rootId)!.title).toBe('Macbeth 2027');
    const shift = diffDays('2026-03-27', '2027-03-26');
    for (const id of copyIds.filter((x) => x !== res.rootId)) {
      const c = h.byId.get(id)!;
      const o = before.find((t) => t.title === c.title)!;
      expect(diffDays(o.startDate, c.startDate)).toBe(shift);
      expect(c.durationDays).toBe(o.durationDays);
      if (c.title === 'Opening Night') expect(c.startDate).toBe('2027-03-26');
    }
    // Every copy is persisted; originals keep their dates (only cached float may change).
    expect(res.changedIds).toEqual(expect.arrayContaining(copyIds));
    for (const o of before) {
      const after = h.byId.get(o.id)!;
      expect([after.title, after.startDate, after.endDate]).toEqual([o.title, o.startDate, o.endDate]);
    }
  });

  it('renames the top task and find/replaces inside subtask titles', () => {
    const res = duplicateGroup(production(), 'P', { ...base, rename: { find: 'Hamlet', replace: 'Macbeth' } }, ids(), NOW);
    const titles = flattenTree(res.tasks).map((r) => r.task.title);
    expect(titles).toContain('Macbeth 2027');
    expect(titles).toContain('Macbeth build');
    expect(titles).toContain('Macbeth set construction');
    expect(titles).toContain('Hamlet set construction'); // original kept
  });

  it('rewires internal links to the copies and drops external ones by default', () => {
    const res = duplicateGroup(production(), 'P', base, ids(), NOW);
    const copy = (title: string) => res.tasks.find((t) => t.title === title && t.id.startsWith('new'))!;
    expect(copy('Scenic paint').dependencies).toEqual([dep(copy('Hamlet set construction').id)]);
    expect(copy('Tech week').dependencies.map((d) => d.predecessorId)).toEqual([copy('Scenic paint').id]);

    const kept = duplicateGroup(production(), 'P', { ...base, keepExternalLinks: true }, ids(), NOW);
    const tech = kept.tasks.find((t) => t.title === 'Tech week' && t.id.startsWith('new'))!;
    expect(tech.dependencies.map((d) => d.predecessorId)).toContain('venue');
  });

  it('resets progress, strips the template tag and keeps sibling order', () => {
    const res = duplicateGroup(production(), 'P', { ...base, keepAssignments: false }, ids(), NOW);
    const root = res.tasks.find((t) => t.id === res.rootId)!;
    expect(root.tags).toEqual(['theatre']);
    const kids = buildHierarchy(res.tasks).children.get(res.rootId)!.map((t) => t.title);
    expect(kids).toEqual(['Hamlet build', 'Tech week', 'Opening Night']);
    const set = res.tasks.find((t) => t.title === 'Hamlet set construction' && t.id.startsWith('new'))!;
    expect(set.progressPercent).toBe(0);
    expect(set.assignedPersonnelIds).toEqual([]);
    const keep = duplicateGroup(production(), 'P', base, ids(), NOW);
    expect(keep.tasks.find((t) => t.title === 'Hamlet set construction' && t.id.startsWith('new'))!.assignedPersonnelIds).toEqual(['ana']);
  });

  it('can anchor on a summary task using its rolled-up start', () => {
    const res = duplicateGroup(production(), 'P', { ...base, anchorId: 'build', anchorDate: '2027-03-01' }, ids(), NOW);
    const build = res.tasks.find((t) => t.title === 'Hamlet build' && t.id.startsWith('new'))!;
    expect(build.startDate).toBe('2027-03-01');
  });

  it('rejects an anchor outside the group and an empty name', () => {
    expect(() => duplicateGroup(production(), 'P', { ...base, anchorId: 'venue' }, ids(), NOW)).toThrow(ValidationError);
    expect(() => duplicateGroup(production(), 'P', { ...base, title: '  ' }, ids(), NOW)).toThrow(ValidationError);
  });
});
