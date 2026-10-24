'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ScheduleOptions } from '@/lib/scheduling/cpm';
import type { TaskInput, TaskItem, TaskPatch } from '@/lib/types';

export interface ScheduleState {
  tasks: TaskItem[];
  projectStart: string | null;
  projectFinish: string | null;
  mode: NonNullable<ScheduleOptions['mode']>;
}

export interface Viewer {
  email: string | null;
  name: string | null;
  image: string | null;
  isAdmin: boolean;
  signInAvailable: boolean;
  devBypass: boolean;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export function useSchedule() {
  const [state, setState] = useState<ScheduleState>({
    tasks: [],
    projectStart: null,
    projectFinish: null,
    mode: 'respect-dates',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((s: ScheduleState) => {
    setState({ tasks: s.tasks, projectStart: s.projectStart, projectFinish: s.projectFinish, mode: s.mode });
    setError(null);
    return s;
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await call<ScheduleState>('/api/tasks'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    void refresh();
    const onFocus = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [refresh]);

  const create = useCallback(
    async (input: TaskInput) =>
      apply(await call<ScheduleState & { id: string }>('/api/tasks', { method: 'POST', body: JSON.stringify(input) })),
    [apply],
  );
  const update = useCallback(
    async (id: string, patch: TaskPatch) =>
      apply(await call<ScheduleState>(`/api/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) })),
    [apply],
  );
  const remove = useCallback(
    async (id: string) => apply(await call<ScheduleState>(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' })),
    [apply],
  );

  return { ...state, loading, error, refresh, create, update, remove };
}

export function useViewer() {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  useEffect(() => {
    call<Viewer>('/api/me')
      .then(setViewer)
      .catch(() =>
        setViewer({ email: null, name: null, image: null, isAdmin: false, signInAvailable: false, devBypass: false }),
      );
  }, []);
  return viewer;
}

/** useState backed by localStorage (per-browser preference). */
export function useStoredState<T extends string>(key: string, initial: T, allowed: readonly T[]) {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const v = localStorage.getItem(key) as T | null;
      if (v && allowed.includes(v)) setValue(v);
    } catch {
      /* storage unavailable */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, v);
      } catch {
        /* storage unavailable */
      }
    },
    [key],
  );
  return [value, set] as const;
}
