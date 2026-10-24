/**
 * Shared domain types. These are persisted to Firestore as-is (one document
 * per task in the `tasks` collection, document id === TaskItem.id).
 */

export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

export const DEPENDENCY_TYPES: readonly DependencyType[] = ['FS', 'SS', 'FF', 'SF'];

export const DEPENDENCY_LABELS: Record<DependencyType, string> = {
  FS: 'Finish-to-Start',
  SS: 'Start-to-Start',
  FF: 'Finish-to-Finish',
  SF: 'Start-to-Finish',
};

export interface TaskDependency {
  predecessorId: string;
  type: DependencyType;
  /** Calendar days; may be negative (lead). */
  lagDays: number;
}

export type TaskKind = 'task' | 'milestone';

export interface TaskItem {
  id: string;
  title: string;
  description?: string;
  type: TaskKind;
  /** ISO 8601 date, YYYY-MM-DD. */
  startDate: string;
  /** ISO 8601 date, YYYY-MM-DD, inclusive. Equals startDate for milestones. */
  endDate: string;
  /** Calendar days. 0 for milestones; >= 1 for tasks. */
  durationDays: number;
  progressPercent: number;
  parentId?: string | null;
  dependencies: TaskDependency[];
  /** Computed by the CPM engine; cached on write, recomputed on read. */
  isCritical?: boolean;
  totalFloat?: number;
  venueId?: string | null;
  assignedPersonnelIds?: string[];
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

/** Fields a client may send when creating a task. */
export type TaskInput = Pick<TaskItem, 'title' | 'type' | 'startDate' | 'durationDays'> &
  Partial<
    Pick<
      TaskItem,
      | 'description'
      | 'progressPercent'
      | 'parentId'
      | 'dependencies'
      | 'venueId'
      | 'assignedPersonnelIds'
      | 'tags'
    >
  >;

/** Fields a client may send when updating a task. */
export type TaskPatch = Partial<TaskInput>;
