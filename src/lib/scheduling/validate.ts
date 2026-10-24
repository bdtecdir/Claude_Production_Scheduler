/**
 * Input validation for task payloads coming from untrusted clients, plus
 * cross-task checks (unknown predecessors, self links).
 */
import { DEPENDENCY_TYPES, type TaskDependency, type TaskInput, type TaskItem, type TaskPatch } from '../types';
import { isIsoDate } from './dates';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 5000;
const MAX_DURATION = 3650;
const MAX_LAG = 3650;

function fail(msg: string): never {
  throw new ValidationError(msg);
}

function parseDependencies(raw: unknown): TaskDependency[] {
  if (!Array.isArray(raw)) fail('dependencies must be an array');
  return raw.map((d, i) => {
    if (!d || typeof d !== 'object') fail(`dependencies[${i}] must be an object`);
    const { predecessorId, type, lagDays } = d as Record<string, unknown>;
    if (typeof predecessorId !== 'string' || !predecessorId) fail(`dependencies[${i}].predecessorId is required`);
    if (!DEPENDENCY_TYPES.includes(type as never)) fail(`dependencies[${i}].type must be one of FS, SS, FF, SF`);
    const lag = lagDays === undefined ? 0 : lagDays;
    if (typeof lag !== 'number' || !Number.isInteger(lag) || Math.abs(lag) > MAX_LAG) {
      fail(`dependencies[${i}].lagDays must be an integer between -${MAX_LAG} and ${MAX_LAG}`);
    }
    return { predecessorId, type: type as TaskDependency['type'], lagDays: lag };
  });
}

function parseStringArray(raw: unknown, field: string): string[] {
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string')) fail(`${field} must be an array of strings`);
  return (raw as string[]).map((s) => s.trim()).filter(Boolean).slice(0, 50);
}

/** Parses a create/update body. `partial` allows any subset of fields. */
export function parseTaskBody(body: unknown, partial: false): TaskInput;
export function parseTaskBody(body: unknown, partial: true): TaskPatch;
export function parseTaskBody(body: unknown, partial: boolean): TaskPatch {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Request body must be a JSON object');
  const b = body as Record<string, unknown>;
  const out: TaskPatch = {};

  if (b.title !== undefined || !partial) {
    if (typeof b.title !== 'string' || !b.title.trim()) fail('title is required');
    if (b.title.length > MAX_TITLE) fail(`title must be at most ${MAX_TITLE} characters`);
    out.title = b.title;
  }
  if (b.type !== undefined || !partial) {
    if (b.type !== 'task' && b.type !== 'milestone') fail('type must be "task" or "milestone"');
    out.type = b.type;
  }
  if (b.startDate !== undefined || !partial) {
    if (!isIsoDate(b.startDate)) fail('startDate must be a valid YYYY-MM-DD date');
    out.startDate = b.startDate;
  }
  if (b.durationDays !== undefined || !partial) {
    const d = b.durationDays ?? (out.type === 'milestone' ? 0 : undefined);
    if (typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > MAX_DURATION) {
      fail(`durationDays must be an integer between 0 and ${MAX_DURATION}`);
    }
    out.durationDays = d;
  }
  if (b.description !== undefined) {
    if (typeof b.description !== 'string' || b.description.length > MAX_DESCRIPTION) {
      fail(`description must be a string of at most ${MAX_DESCRIPTION} characters`);
    }
    out.description = b.description;
  }
  if (b.progressPercent !== undefined) {
    const p = b.progressPercent;
    if (typeof p !== 'number' || p < 0 || p > 100) fail('progressPercent must be between 0 and 100');
    out.progressPercent = p;
  }
  if (b.parentId !== undefined) {
    if (b.parentId !== null && (typeof b.parentId !== 'string' || !b.parentId)) fail('parentId must be a task id or null');
    out.parentId = b.parentId as string | null;
  }
  if (b.dependencies !== undefined) out.dependencies = parseDependencies(b.dependencies);
  if (b.venueId !== undefined) {
    if (b.venueId !== null && typeof b.venueId !== 'string') fail('venueId must be a string or null');
    out.venueId = b.venueId as string | null;
  }
  if (b.assignedPersonnelIds !== undefined) {
    out.assignedPersonnelIds = parseStringArray(b.assignedPersonnelIds, 'assignedPersonnelIds');
  }
  if (b.tags !== undefined) out.tags = parseStringArray(b.tags, 'tags');
  return out;
}

export interface DuplicateBody {
  title: string;
  rename?: { find: string; replace: string };
  anchorId: string;
  anchorDate: string;
  keepExternalLinks: boolean;
  keepAssignments: boolean;
}

/** Parses a "duplicate group" request body. */
export function parseDuplicateBody(body: unknown): DuplicateBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Request body must be a JSON object');
  const b = body as Record<string, unknown>;
  if (typeof b.title !== 'string' || !b.title.trim()) fail('title is required');
  if (b.title.length > MAX_TITLE) fail(`title must be at most ${MAX_TITLE} characters`);
  if (typeof b.anchorId !== 'string' || !b.anchorId) fail('anchorId is required');
  if (!isIsoDate(b.anchorDate)) fail('anchorDate must be a valid YYYY-MM-DD date');
  let rename: DuplicateBody['rename'];
  if (b.rename !== undefined && b.rename !== null) {
    const r = b.rename as Record<string, unknown>;
    if (typeof r !== 'object' || typeof r.find !== 'string' || typeof r.replace !== 'string') {
      fail('rename must be { find, replace } strings');
    }
    if (r.find.length > MAX_TITLE || r.replace.length > MAX_TITLE) fail(`rename text must be at most ${MAX_TITLE} characters`);
    rename = { find: r.find, replace: r.replace };
  }
  return {
    title: b.title,
    rename,
    anchorId: b.anchorId,
    anchorDate: b.anchorDate,
    keepExternalLinks: b.keepExternalLinks === true,
    keepAssignments: b.keepAssignments !== false,
  };
}

/** Cross-task checks for the task that was just created/edited. */
export function assertValidPatch(tasks: readonly TaskItem[], id: string): void {
  const ids = new Set(tasks.map((t) => t.id));
  const t = tasks.find((x) => x.id === id)!;
  if (t.parentId && !ids.has(t.parentId)) fail('The selected parent task does not exist');
  if (t.parentId === t.id) fail('A task cannot be its own parent');
  for (const d of t.dependencies) {
    if (d.predecessorId === t.id) fail(`"${t.title}" cannot depend on itself`);
    if (!ids.has(d.predecessorId)) fail(`Predecessor ${d.predecessorId} does not exist`);
  }
}
