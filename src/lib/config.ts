import 'server-only';
import type { ScheduleOptions } from './scheduling';

export const config = {
  dataBackend: (process.env.DATA_BACKEND ?? 'firestore') as 'firestore' | 'memory',
  firestore: {
    projectId: process.env.GOOGLE_CLOUD_PROJECT || undefined,
    databaseId: process.env.FIRESTORE_DATABASE_ID || '(default)',
    collection: process.env.FIRESTORE_COLLECTION || 'tasks',
  },
  scheduleMode: (process.env.SCHEDULE_MODE === 'asap' ? 'asap' : 'respect-dates') as NonNullable<
    ScheduleOptions['mode']
  >,
  auth: {
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    adminEmails: (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    adminDomain: (process.env.ADMIN_EMAIL_DOMAIN ?? '').trim().toLowerCase(),
    devBypass: process.env.AUTH_DEV_BYPASS === 'true' && process.env.NODE_ENV !== 'production',
  },
};

export const isGoogleAuthConfigured = () =>
  Boolean(config.auth.googleClientId && config.auth.googleClientSecret);
