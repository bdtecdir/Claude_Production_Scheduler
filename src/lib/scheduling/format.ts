import type { TaskDependency, TaskItem } from '../types';

/** "1.2FS+3d", "4SS", "2FF-1d" (MS Project style). */
export function formatDependency(dep: TaskDependency, wbs: ReadonlyMap<string, string>): string {
  const code = wbs.get(dep.predecessorId) ?? '?';
  const lag = dep.lagDays ? `${dep.lagDays > 0 ? '+' : ''}${dep.lagDays}d` : '';
  return `${code}${dep.type}${lag}`;
}

export function taskStatus(t: Pick<TaskItem, 'progressPercent'>): 'Not started' | 'In progress' | 'Complete' {
  if (t.progressPercent >= 100) return 'Complete';
  if (t.progressPercent > 0) return 'In progress';
  return 'Not started';
}
