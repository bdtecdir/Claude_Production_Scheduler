import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { errorResponse, readJson, requireAdmin, scheduleOptions, scheduleResponse } from '@/lib/api';
import { getRepository } from '@/lib/db';
import { duplicateGroup, parseDuplicateBody } from '@/lib/scheduling';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Admin: copy a task and its subtree, re-anchored to a new date, in one transaction. */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(req);
    const { id } = await params;
    const body = parseDuplicateBody(await readJson(req));
    const now = new Date().toISOString();
    let rootId = '';
    const result = await getRepository().mutate((tasks) => {
      const r = duplicateGroup(tasks, id, body, randomUUID, now, scheduleOptions());
      rootId = r.rootId;
      return r;
    });
    return scheduleResponse(result, 201, { id: rootId });
  } catch (err) {
    return errorResponse(err);
  }
}
