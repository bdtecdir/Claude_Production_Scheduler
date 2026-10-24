import 'server-only';
import { config } from '../config';
import { FirestoreTaskRepository } from './firestore';
import { MemoryTaskRepository } from './memory';
import type { TaskRepository } from './repository';

let repo: TaskRepository | undefined;

export function getRepository(): TaskRepository {
  repo ??= config.dataBackend === 'memory' ? new MemoryTaskRepository() : new FirestoreTaskRepository();
  return repo;
}

export type { TaskRepository };
