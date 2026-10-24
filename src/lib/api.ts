import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { getViewer } from './auth';
import { config } from './config';
import { CycleError, ValidationError, type MutationResult, type ScheduleResult } from './scheduling';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const scheduleOptions = () => ({ mode: config.scheduleMode });

/** Admin gate + basic CSRF defence for cookie-authenticated mutations. */
export async function requireAdmin(req: NextRequest): Promise<void> {
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (origin && host && new URL(origin).host !== host) throw new HttpError(403, 'Cross-origin request rejected');
  if (!req.headers.get('content-type')?.includes('application/json') && req.method !== 'DELETE') {
    throw new HttpError(415, 'Expected application/json');
  }
  const viewer = await getViewer();
  if (!viewer.email) throw new HttpError(401, 'Sign in with Google to make changes');
  if (!viewer.isAdmin) throw new HttpError(403, 'Your account does not have admin access');
}

export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON');
  }
}

export function scheduleResponse(result: ScheduleResult | MutationResult, status = 200, extra: object = {}) {
  return NextResponse.json(
    {
      tasks: result.tasks,
      projectStart: result.projectStart,
      projectFinish: result.projectFinish,
      changedIds: result.changedIds,
      // Lets the UI run identical drag previews client-side.
      mode: config.scheduleMode,
      ...('deletedIds' in result ? { deletedIds: result.deletedIds } : {}),
      ...extra,
    },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof CycleError) {
    return NextResponse.json({ error: err.message, cycle: err.cycle }, { status: 409 });
  }
  if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
  console.error(err);
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
}
