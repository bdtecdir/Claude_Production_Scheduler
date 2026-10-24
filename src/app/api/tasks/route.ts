import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { errorResponse, readJson, requireAdmin, scheduleOptions, scheduleResponse } from '@/lib/api';
import { getRepository } from '@/lib/db';
import { buildTask, createTask, parseTaskBody, schedule } from '@/lib/scheduling';

export const dynamic = 'force-dynamic';

/** Public: the full schedule with CPM fields freshly computed. */
export async function GET() {
  try {
    const tasks = await getRepository().list();
    return scheduleResponse(schedule(tasks, scheduleOptions()));
  } catch (err) {
    return errorResponse(err);
  }
}

/** Admin: create a task or milestone; cascades and returns the new schedule. */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const input = parseTaskBody(await readJson(req), false);
    const task = buildTask(randomUUID(), input, new Date().toISOString());
    const result = await getRepository().mutate((tasks) => createTask(tasks, task, scheduleOptions()));
    return scheduleResponse(result, 201, { id: task.id });
  } catch (err) {
    return errorResponse(err);
  }
}
