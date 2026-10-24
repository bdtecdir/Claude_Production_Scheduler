import type { NextRequest } from 'next/server';
import { errorResponse, readJson, requireAdmin, scheduleOptions, scheduleResponse } from '@/lib/api';
import { getRepository } from '@/lib/db';
import { deleteTask, parseTaskBody, updateTask } from '@/lib/scheduling';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(req);
    const { id } = await params;
    const patch = parseTaskBody(await readJson(req), true);
    const now = new Date().toISOString();
    const result = await getRepository().mutate((tasks) => updateTask(tasks, id, patch, now, scheduleOptions()));
    return scheduleResponse(result);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(req);
    const { id } = await params;
    const now = new Date().toISOString();
    const result = await getRepository().mutate((tasks) => deleteTask(tasks, id, now, scheduleOptions()));
    return scheduleResponse(result);
  } catch (err) {
    return errorResponse(err);
  }
}
