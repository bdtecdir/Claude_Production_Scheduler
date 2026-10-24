import type { ScheduleOptions } from '@/lib/scheduling';
import type { TaskItem, TaskKind, TaskPatch } from '@/lib/types';

export interface AddDefaults {
  startDate?: string;
  parentId?: string | null;
  type?: TaskKind;
}

export interface ViewProps {
  tasks: TaskItem[];
  canEdit: boolean;
  scheduleMode: NonNullable<ScheduleOptions['mode']>;
  /** Opens the details/edit form (read-only for viewers). */
  onOpen: (task: TaskItem) => void;
  onAdd: (defaults?: AddDefaults) => void;
  onUpdate: (id: string, patch: TaskPatch) => Promise<unknown>;
  onDelete: (task: TaskItem) => void;
  /** Opens the "duplicate group" dialog for a task and its subtree. */
  onDuplicate: (task: TaskItem) => void;
}
