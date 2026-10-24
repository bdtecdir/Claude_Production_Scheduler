import type { DependencyType, TaskItem } from '../../types';
import { normalizeTask } from '../mutations';

let seq = 0;

export function mk(
  id: string,
  startDate: string,
  durationDays: number,
  extra: Partial<TaskItem> = {},
): TaskItem {
  seq += 1;
  return normalizeTask({
    id,
    title: id,
    type: durationDays === 0 ? 'milestone' : 'task',
    startDate,
    endDate: startDate,
    durationDays,
    progressPercent: 0,
    parentId: null,
    dependencies: [],
    createdAt: `2026-01-01T00:00:${String(seq).padStart(2, '0')}.000Z`,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  });
}

export const dep = (predecessorId: string, type: DependencyType = 'FS', lagDays = 0) => ({
  predecessorId,
  type,
  lagDays,
});

export function byId(tasks: TaskItem[]): Record<string, TaskItem> {
  return Object.fromEntries(tasks.map((t) => [t.id, t]));
}
