import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Sidebar } from '@/components/sidebar';
import { getLocale, localeTag, setServerLocaleTag } from '@/lib/i18n';
import { AutoRefresh } from '@/components/auto-refresh';
import { ExportBar } from '@/components/export-bar';
import { getCurrentProject, getLastIngestAt, getProjects, getPulse, getRecentAlertCount } from '@/lib/data';
import { LiveFavicon } from '@/components/live-favicon';
import { getCurrentUser } from '@/lib/auth';
import { countPeople } from '@/lib/people-insights';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: {
    default: 'Muapi Radar — Media Intelligence & Social Listening',
    template: '%s — Muapi Radar',
  },
  description: 'Media intelligence and social listening engine powered by Muapi',
};

// Tutte le pagine leggono dal database a ogni richiesta: niente prerender statico.
export const dynamic = 'force-dynamic';

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [projects, current, lastIngest, user] = await Promise.all([
    getProjects(), getCurrentProject(), getLastIngestAt(), getCurrentUser(),
  ]);
  const alertCount = current ? await getRecentAlertCount(current.id) : 0;
  const peopleCount = current ? await countPeople(current.id) : 0;
  const pulse = current ? await getPulse(current.id) : { mentions24h: 0, sentiment: null };
  const stale = !lastIngest || Date.now() - lastIngest.getTime() > 2 * 3600_000;

  const demo = process.env.DEMO_MODE === '1';
  const locale = await getLocale();
  // Le date lato server seguono la lingua scelta (fmtDate legge questo tag).
  setServerLocaleTag(locale);

  return (
    <html lang={locale} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        {demo && (
          <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.02] px-4 py-1.5 text-xs text-slate-400">
            <div className="mx-auto flex items-center gap-2">
              <span className="flex size-1.5 rounded-full bg-cyan-400" />
              <span className="font-medium text-slate-200">Live Demo</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400">Sample data loaded · Real-time listening active</span>
            </div>
          </div>
        )}
        <div className="flex min-h-screen flex-col lg:flex-row">
          <Sidebar
            projects={projects.map((p) => ({ id: p.id, name: p.name }))}
            currentId={current?.id ?? null}
            lastIngest={lastIngest?.toISOString() ?? null}
            alertCount={alertCount}
            peopleCount={peopleCount}
            user={user ? { name: user.name, role: user.role } : null}
            locale={locale}
          />
          <div className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-10 lg:py-6">
            <div className="mx-auto max-w-[1250px]">
              <ExportBar />
              <main>{children}</main>
            </div>
          </div>
        </div>
        <AutoRefresh stale={stale} />
        <LiveFavicon sentiment={pulse.sentiment} mentions24h={pulse.mentions24h} alerts={alertCount} />
      </body>
    </html>
  );
}
