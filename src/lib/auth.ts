import 'server-only';
import type { NextAuthOptions } from 'next-auth';
import { getServerSession } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { config, isGoogleAuthConfigured } from './config';

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  if (config.auth.adminEmails.includes(e)) return true;
  return Boolean(config.auth.adminDomain) && e.endsWith(`@${config.auth.adminDomain}`);
}

export const authOptions: NextAuthOptions = {
  providers: isGoogleAuthConfigured()
    ? [
        GoogleProvider({
          clientId: config.auth.googleClientId,
          clientSecret: config.auth.googleClientSecret,
        }),
      ]
    : [],
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  callbacks: {
    // Anyone may sign in (public read is open anyway); admin rights are
    // decided per request from the allowlist so revocation is immediate.
    async signIn({ account, profile }) {
      if (account?.provider !== 'google') return false;
      return (profile as { email_verified?: boolean } | undefined)?.email_verified === true;
    },
    async session({ session }) {
      if (session.user) session.user.isAdmin = isAdminEmail(session.user.email);
      return session;
    },
  },
};

export interface Viewer {
  email: string | null;
  name: string | null;
  image: string | null;
  isAdmin: boolean;
}

export async function getViewer(): Promise<Viewer> {
  if (config.auth.devBypass) {
    return { email: 'dev@localhost', name: 'Local admin (dev bypass)', image: null, isAdmin: true };
  }
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? null;
  return {
    email,
    name: session?.user?.name ?? null,
    image: session?.user?.image ?? null,
    isAdmin: isAdminEmail(email),
  };
}
