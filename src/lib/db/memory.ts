import 'server-only';
import type { TaskItem } from '../types';
import type { TaskRepository } from './repository';
import { seedTasks } from './seed';

const globalForMemory = globalThis as unknown as { __memoryTasks?: Map<string, TaskItem> };

/** In-process store for local development and demos. Not persisted. */
export class MemoryTaskRepository implements TaskRepository {
  private get store() {
    if (!globalForMemory.__memoryTasks) {
      globalForMemory.__memoryTasks = new Map(seedTasks().map((t) => [t.id, t]));
    }
    return globalForMemory.__memoryTasks;
  }

  async list() {
    return [...this.store.values()].map((t) => structuredClone(t));
  }

  async mutate(fn: Parameters<TaskRepository['mutate']>[0]) {
    // Single-threaded event loop: no await between read and write, so this is atomic.
    const result = fn([...this.store.values()].map((t) => structuredClone(t)));
    const byId = new Map(result.tasks.map((t) => [t.id, t]));
    for (const id of result.changedIds) this.store.set(id, structuredClone(byId.get(id)!));
    for (const id of result.deletedIds) this.store.delete(id);
    return result;
  }
}
