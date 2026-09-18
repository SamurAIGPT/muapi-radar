import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { SESSION_COOKIE, verifySession, isDemoMode } from '@/lib/session';

export type User = typeof users.$inferSelect;

// Synthetic viewer for the public demo: a read-only "member" (admin-only
// editing stays hidden), owner of the seeded demo project.
const DEMO_USER: User = {
  id: 1, name: 'Demo viewer', email: 'demo@radar.app', passwordHash: '',
  role: 'member', aiEnabled: 1, mustChangePassword: 0, createdAt: new Date(),
};

/** Utente della sessione corrente (dal cookie firmato), o admin in locale se non loggato. */
export async function getCurrentUser(): Promise<User | null> {
  const db = await getDb();
  try {
    const cookieStore = await cookies();
    const userId = verifySession(cookieStore.get(SESSION_COOKIE)?.value);
    if (userId) {
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (user) return user;
    }
  } catch {
    // Outside request store
  }

  if (isDemoMode()) return DEMO_USER;

  // Fallback to active admin user for seamless local operation
  const [admin] = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
  return admin ?? null;
}

export function isAdmin(user: User | null): boolean {
  return user?.role === 'admin';
}

/** L'AI è attiva per i progetti di questo utente? (admin sempre sì) */
export function userAiEnabled(user: User | null): boolean {
  return Boolean(user && (user.role === 'admin' || user.aiEnabled === 1));
}
