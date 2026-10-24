import 'server-only';
import { Firestore, type DocumentData } from '@google-cloud/firestore';
import { config } from '../config';
import type { TaskItem } from '../types';
import type { TaskRepository } from './repository';

/** Firestore allows 500 writes per transaction. */
const MAX_WRITES = 500;

const globalForFirestore = globalThis as unknown as { __firestore?: Firestore };

/**
 * Singleton client. On Cloud Run, credentials come from the service's
 * attached service account via Application Default Credentials; locally,
 * from `gcloud auth application-default login` or FIRESTORE_EMULATOR_HOST.
 */
export function getFirestore(): Firestore {
  if (!globalForFirestore.__firestore) {
    globalForFirestore.__firestore = new Firestore({
      projectId: config.firestore.projectId,
      databaseId: config.firestore.databaseId,
      ignoreUndefinedProperties: true,
    });
  }
  return globalForFirestore.__firestore;
}

function fromDoc(id: string, d: DocumentData): TaskItem {
  return {
    id,
    title: String(d.title ?? ''),
    description: d.description ?? '',
    type: d.type === 'milestone' ? 'milestone' : 'task',
    startDate: d.startDate,
    endDate: d.endDate,
    durationDays: Number(d.durationDays ?? 0),
    progressPercent: Number(d.progressPercent ?? 0),
    parentId: d.parentId ?? null,
    dependencies: Array.isArray(d.dependencies) ? d.dependencies : [],
    isCritical: d.isCritical,
    totalFloat: d.totalFloat,
    venueId: d.venueId ?? null,
    assignedPersonnelIds: d.assignedPersonnelIds ?? [],
    tags: d.tags ?? [],
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

function toDoc(t: TaskItem): DocumentData {
  const { id: _id, ...rest } = t;
  return rest;
}

export class FirestoreTaskRepository implements TaskRepository {
  private get col() {
    return getFirestore().collection(config.firestore.collection);
  }

  async list(): Promise<TaskItem[]> {
    const snap = await this.col.get();
    return snap.docs.map((d) => fromDoc(d.id, d.data()));
  }

  async mutate(fn: Parameters<TaskRepository['mutate']>[0]) {
    return getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(this.col);
      const result = fn(snap.docs.map((d) => fromDoc(d.id, d.data())));
      const writes = result.changedIds.length + result.deletedIds.length;
      if (writes > MAX_WRITES) {
        throw new Error(`This change would update ${writes} tasks; the limit per change is ${MAX_WRITES}.`);
      }
      const byId = new Map(result.tasks.map((t) => [t.id, t]));
      for (const id of result.changedIds) tx.set(this.col.doc(id), toDoc(byId.get(id)!));
      for (const id of result.deletedIds) tx.delete(this.col.doc(id));
      return result;
    });
  }
}
