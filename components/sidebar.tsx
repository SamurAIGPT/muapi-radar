'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Settings, Menu, X, UserCog, LogOut, UserCircle2 } from 'lucide-react';
import { RefreshButton } from './refresh-button';
import { Brand } from './brand';
import { LocaleSwitch } from './locale-switch';
import { tFor, type Locale } from '@/lib/i18n-dict';
import { NAV, type NavItem } from '@/lib/nav';
import { CommandPalette, CommandHint } from './command-palette';

// Menu organizzato per INTENZIONE (cosa stai facendo), non per tecnologia:
// monitorare → analizzare → interpretare → produrre → configurare.
// I 16 insight non stanno più in elenco: vivono nell'hub /insights, raggruppati
// per tema. Così il menu resta leggibile e ogni grafico è spiegato dove sta.
//
// In fondo, staccate da una riga, le sezioni che NON sono un'intenzione ma un
// mondo di dati a sé: hanno fonti proprie, tabelle proprie e un'analisi che non
// passa dalle mention. Tenerle nell'elenco principale le faceva sembrare un
// altro modo di guardare le stesse cose, che non sono.
const ACCENT: Record<string, string> = {
  reviews: 'text-emerald-400/80',
  sport: 'text-amber-400/80',
  wikipedia: 'text-slate-400',
};



type Props = {
  projects: { id: number; name: string }[];
  currentId: number | null;
  lastIngest: string | null;
  alertCount?: number;
  /** Quante persone ha il progetto: il menù lo dice, altrimenti non si trovano. */
  peopleCount?: number;
  user?: { name: string; role: string } | null;
  locale?: Locale;
};

export function Sidebar({ projects, currentId, lastIngest, alertCount = 0, peopleCount = 0, user = null, locale = 'en' }: Props) {
  const t = tFor(locale);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logout: true }),
    });
    window.location.href = '/login';
  }

  const userBlock = user && (
    <div className="border-t border-white/[0.07] pt-2.5">
      <div className="flex items-center gap-2 px-1.5 py-1">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-cyan-500/10 text-xs font-semibold text-cyan-400">
          {user.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-slate-200">{user.name}</p>
          <p className="text-[9.5px] font-semibold uppercase tracking-wider text-slate-500">{user.role === 'admin' ? t('nav.admin', 'Admin') : t('nav.member', 'Member')}</p>
        </div>
      </div>
      <div className="mt-1 flex items-center gap-1">
        <Link href="/impostazioni/account" onClick={() => setOpen(false)}
          className="flex flex-1 items-center gap-2 rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-white/[0.05] hover:text-slate-200">
          <UserCog className="size-3.5" /> {t('nav.account', 'Settings')}
        </Link>
        <LocaleSwitch current={locale} compact />
      </div>
      <button onClick={logout}
        className="mt-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-white/[0.05] hover:text-rose-300">
        <LogOut className="size-3.5" /> {t('nav.logout', 'Log out')}
      </button>
    </div>
  );

  return (
    <>
      <CommandPalette locale={locale} />

      {/* Header mobile/tablet (sotto lg) */}
      <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-white/[0.07] bg-[#0b0e17]/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <button onClick={() => setOpen(true)} aria-label="Open menu"
          className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10">
          <Menu className="size-5" />
        </button>
        <Brand size="sm" />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <LocaleSwitch current={locale} compact />
          <ProjectSelect projects={projects} currentId={currentId} compact />
        </div>
      </header>

      {/* Drawer mobile */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-3.5 overflow-y-auto bg-[#0b0e17] px-3.5 py-4 shadow-2xl">
            <div className="flex items-center gap-2 px-1">
              <Brand />
              <button onClick={() => setOpen(false)} aria-label="Close menu"
                className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-white/10">
                <X className="size-5" />
              </button>
            </div>
            <ProjectSelect projects={projects} currentId={currentId} />
            <CommandHint locale={locale} />
            <NavLinks pathname={pathname} alertCount={alertCount} peopleCount={peopleCount} t={t} onNavigate={() => setOpen(false)} />
            {userBlock}
            <FooterBlock lastIngest={lastIngest} />
          </div>
        </div>
      )}

      {/* Sidebar desktop (da lg in su) */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-3 border-r border-white/[0.07] bg-[#0b0e17] px-3.5 py-4 lg:flex">
        <div className="px-1">
          <Brand />
        </div>
        <ProjectSelect projects={projects} currentId={currentId} />
        <CommandHint locale={locale} />
        <NavLinks pathname={pathname} alertCount={alertCount} peopleCount={peopleCount} t={t} />
        <div className="mt-auto flex flex-col gap-2.5">
          {userBlock}
          <FooterBlock lastIngest={lastIngest} />
        </div>
      </aside>
    </>
  );
}

function ProjectSelect({ projects, currentId, compact }: {
  projects: Props['projects']; currentId: number | null; compact?: boolean;
}) {
  const router = useRouter();
  if (projects.length === 0) return null;
  return (
    <select
      value={currentId ?? undefined}
      onChange={(e) => {
        document.cookie = `sr_project=${e.target.value};path=/;max-age=31536000`;
        router.refresh();
      }}
      className={`rounded-lg border border-white/[0.08] bg-white/[0.03] text-xs font-medium text-slate-200 outline-none transition hover:border-white/15 hover:bg-white/[0.06] focus:border-cyan-500/50 cursor-pointer ${
        compact ? 'max-w-[38vw] truncate px-2 py-1 text-xs' : 'w-full truncate px-2.5 py-1.5'
      }`}
    >
      {projects.map((p) => (
        <option key={p.id} value={p.id} className="bg-[#0e1320] text-slate-200">{p.name}</option>
      ))}
    </select>
  );
}

/**
 * Il menù, letto per PESO.
 */
function NavLinks({ pathname, alertCount = 0, peopleCount = 0, t, onNavigate }: {
  pathname: string; alertCount?: number; peopleCount?: number;
  t: (k: string, f: string) => string; onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-0.5 overflow-y-auto pr-1 select-none">
      {NAV.map((item, i) => {
        if ('section' in item) {
          return item.section
            ? <p key={i} className="mb-1 mt-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t(item.key, item.section)}</p>
            : <hr key={i} className="my-1.5 border-white/[0.06]" />;
        }
        const { href, label, key, icon: Icon, primary } = item;
        const accent = 'accent' in item ? item.accent : undefined;
        const active = href === '/insights'
          ? pathname.startsWith('/insights')
          : href === '/riscontri'
            ? ['/riscontri', '/verifiche', '/evidenze', '/podcast'].includes(pathname)
          : href === '/story'
            ? ['/narratives', '/timeline', '/stakeholders', '/messages'].includes(pathname)
            : href === '/measures'
              ? pathname === '/measures' || pathname === '/people'
              : pathname === href;

        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={`flex items-center gap-2.5 rounded-lg transition-colors ${
              primary ? 'px-2.5 py-1.5 text-[13.5px]' : 'py-1 pl-2.5 pr-2 text-[12.5px]'
            } ${
              active
                ? 'bg-white/[0.07] font-medium text-white shadow-sm'
                : primary
                  ? 'text-slate-300 hover:bg-white/[0.04] hover:text-white'
                  : 'text-slate-400 hover:bg-white/[0.03] hover:text-slate-200'
            }`}
          >
            {primary || accent
              ? <Icon className={`size-4 shrink-0 ${active ? 'text-cyan-400' : accent ? ACCENT[accent] : 'text-slate-400'}`} />
              : <span className={`ml-[3px] mr-[7px] size-[3px] shrink-0 rounded-full ${active ? 'bg-cyan-400' : 'bg-current opacity-40'}`} />}
            <span className="truncate">{t(key, label)}</span>
            {href === '/measures' && peopleCount > 0 && (
              <span title={`${peopleCount} people`}
                className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-white/10 px-1 text-[10px] font-semibold text-slate-300">
                {peopleCount}
              </span>
            )}
            {href === '/alerts' && alertCount > 0 && (
              <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500/90 px-1.5 text-[10px] font-bold text-white">
                {alertCount > 9 ? '9+' : alertCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function FooterBlock({ lastIngest }: { lastIngest: string | null }) {
  return (
    <div className="mt-auto flex flex-col gap-1.5 pt-1">
      <RefreshButton />
      <p className="px-0.5 text-center text-[10px] text-slate-500">
        {lastIngest
          ? `Updated: ${new Date(lastIngest).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
          : 'No data collected yet'}
      </p>
    </div>
  );
}
