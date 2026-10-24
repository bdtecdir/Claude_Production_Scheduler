import type { TaskItem } from '../types';
import type { MutationResult } from '../scheduling';

/**
 * Persistence boundary. `mutate` must run `fn` against a consistent snapshot
 * of all tasks and persist exactly `changedIds` / `deletedIds` atomically, so
 * cascaded date shifts never land half-written.
 */
export interface TaskRepository {
  list(): Promise<TaskItem[]>;
  mutate(fn: (tasks: TaskItem[]) => MutationResult): Promise<MutationResult>;
}
