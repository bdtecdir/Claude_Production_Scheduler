import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth';
import { config, isGoogleAuthConfigured } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  const viewer = await getViewer();
  return NextResponse.json(
    { ...viewer, signInAvailable: isGoogleAuthConfigured(), devBypass: config.auth.devBypass },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
