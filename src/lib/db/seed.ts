import type { TaskDependency, TaskItem } from '../types';
import { addDays, dayOfWeek, todayIso } from '../scheduling/dates';
import { normalizeTask } from '../scheduling/mutations';
import { schedule } from '../scheduling/cpm';

/**
 * A small theatre-production schedule anchored to the current week, used by
 * the memory backend (DATA_BACKEND=memory).
 */
export function seedTasks(): TaskItem[] {
  const today = todayIso();
  const monday = addDays(today, -((dayOfWeek(today) + 6) % 7) - 7);
  const now = new Date().toISOString();
  let n = 0;

  const t = (
    id: string,
    title: string,
    offset: number,
    durationDays: number,
    extra: Partial<TaskItem> & { deps?: TaskDependency[] } = {},
  ): TaskItem => {
    n += 1;
    const { deps, ...rest } = extra;
    return normalizeTask({
      id,
      title,
      description: '',
      type: durationDays === 0 ? 'milestone' : 'task',
      startDate: addDays(monday, offset),
      endDate: addDays(monday, offset),
      durationDays,
      progressPercent: 0,
      parentId: null,
      dependencies: deps ?? [],
      venueId: null,
      assignedPersonnelIds: [],
      tags: [],
      // Spread creation times so sibling order (and WBS) is stable.
      createdAt: new Date(Date.parse(now) + n * 1000).toISOString(),
      updatedAt: now,
      ...rest,
    });
  };
  const fs = (predecessorId: string, lagDays = 0): TaskDependency => ({ predecessorId, type: 'FS', lagDays });

  const tasks = [
    t('pre', 'Pre-production', 0, 1, { tags: ['phase'] }),
    t('concept', 'Concept & creative brief', 0, 4, { parentId: 'pre', progressPercent: 100 }),
    t('script', 'Script lock', 0, 5, { parentId: 'pre', progressPercent: 80, deps: [fs('concept')] }),
    t('budget', 'Budget sign-off', 0, 0, { parentId: 'pre', deps: [fs('script')] }),
    t('casting', 'Casting', 4, 6, { parentId: 'pre', progressPercent: 40, deps: [{ predecessorId: 'concept', type: 'SS', lagDays: 2 }] }),

    t('build', 'Design & build', 0, 1, { tags: ['phase'], deps: [fs('budget')] }),
    t('setdesign', 'Set design', 0, 5, { parentId: 'build', progressPercent: 10 }),
    t('setbuild', 'Set construction', 0, 10, { parentId: 'build', deps: [fs('setdesign')] }),
    t('lx', 'Lighting design', 0, 6, { parentId: 'build', deps: [{ predecessorId: 'setdesign', type: 'SS', lagDays: 2 }] }),
    t('costume', 'Costume fabrication', 0, 8, { parentId: 'build', deps: [{ predecessorId: 'setbuild', type: 'FF', lagDays: 0 }] }),

    t('reh', 'Rehearsals', 0, 1, { tags: ['phase'] }),
    t('readthru', 'Table read', 0, 1, { parentId: 'reh', deps: [fs('casting'), fs('script')] }),
    t('blocking', 'Blocking rehearsals', 0, 10, { parentId: 'reh', deps: [fs('readthru')] }),
    t('tech', 'Tech week', 0, 5, { parentId: 'reh', deps: [fs('blocking'), fs('setbuild'), fs('lx')] }),
    t('dress', 'Final dress', 0, 1, { parentId: 'reh', deps: [fs('tech'), fs('costume')] }),

    t('opening', 'Opening night', 0, 0, { deps: [fs('dress', 1)], tags: ['public'] }),
    t('press', 'Press release', 0, 2, { deps: [{ predecessorId: 'opening', type: 'SF', lagDays: -3 }] }),
  ];
  return schedule(tasks).tasks;
}
