// Local Firestore connectivity check. Uses the same env vars as src/lib/config.ts.
// Usage: node --env-file=.env.local scripts/firestore-healthcheck.mjs [--write]
// Default is read-only. --write also writes and deletes a doc in `_healthcheck` (never in a tasks collection).
import { Firestore } from '@google-cloud/firestore';

const projectId = process.env.GOOGLE_CLOUD_PROJECT || undefined;
const databaseId = process.env.FIRESTORE_DATABASE_ID || '(default)';
const collection = process.env.FIRESTORE_COLLECTION || 'tasks';
const write = process.argv.includes('--write');

const db = new Firestore({ projectId, databaseId });

try {
  const resolvedProject = await db.formattedName.split('/')[1];
  console.log(`project:    ${resolvedProject}`);
  console.log(`database:   ${databaseId}`);
  console.log(`emulator:   ${process.env.FIRESTORE_EMULATOR_HOST || 'no'}`);

  const count = (await db.collection(collection).count().get()).data().count;
  console.log(`collection: ${collection} (${count} docs)`);

  if (write) {
    const ref = db.collection('_healthcheck').doc(`local-${process.env.COMPUTERNAME || 'dev'}`);
    const at = new Date().toISOString();
    await ref.set({ at, source: 'scripts/firestore-healthcheck.mjs' });
    const back = (await ref.get()).data();
    await ref.delete();
    if (back?.at !== at) throw new Error('read-back mismatch');
    console.log('write/read/delete: ok');
  }
  console.log('Firestore health check: OK');
} catch (err) {
  console.error('Firestore health check: FAILED');
  console.error(err.message ?? err);
  process.exitCode = 1;
} finally {
  await db.terminate().catch(() => {});
}
