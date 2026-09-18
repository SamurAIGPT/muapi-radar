import { fetchJson } from '@/lib/connectors/util';
import { cfg } from '@/lib/connector-config';

export type SportMatch = {
  externalId: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  utcDate: Date;
};
export type TeamHit = { id: string; name: string; shortName: string; crest: string | null };

type FdMatch = {
  id: number; utcDate: string; status: string;
  competition: { code: string };
  homeTeam: { name: string }; awayTeam: { name: string };
  score: { fullTime: { home: number | null; away: number | null } };
};
type FdTeam = { id: number; name: string; shortName?: string; tla?: string; crest?: string | null };

export function footballDataEnabled(): boolean {
  return Boolean(cfg('FOOTBALL_DATA_API_KEY'));
}

function ymd(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'UTC' });
}

export async function searchTeams(competition: string, query: string): Promise<{ teams: TeamHit[]; keyMissing: boolean }> {
  const key = cfg('FOOTBALL_DATA_API_KEY');
  if (!key) return { teams: [], keyMissing: true };
  if (query.trim().length < 2) return { teams: [], keyMissing: false };
  const data = await fetchJson<{ teams?: FdTeam[] }>(
    `https://api.football-data.org/v4/competitions/${encodeURIComponent(competition)}/teams`,
    { headers: { 'X-Auth-Token': key } },
  );
  const q = query.trim().toLowerCase();
  const teams = (data.teams ?? [])
    .filter((t) => t.name.toLowerCase().includes(q) || (t.shortName ?? '').toLowerCase().includes(q) || (t.tla ?? '').toLowerCase() === q)
    .slice(0, 8)
    .map((t) => ({ id: String(t.id), name: t.name, shortName: t.shortName ?? t.name, crest: t.crest ?? null }));
  return { teams, keyMissing: false };
}

export async function fetchTeamMatches(teamId: string, limit = 40): Promise<SportMatch[]> {
  const key = cfg('FOOTBALL_DATA_API_KEY');
  if (!key) return [];
  const now = Date.now();
  const params = new URLSearchParams({
    dateFrom: ymd(new Date(now - 200 * 86400_000)),
    dateTo: ymd(new Date(now + 60 * 86400_000)),
    limit: String(limit),
  });
  const data = await fetchJson<{ matches?: FdMatch[] }>(
    `https://api.football-data.org/v4/teams/${encodeURIComponent(teamId)}/matches?${params}`,
    { headers: { 'X-Auth-Token': key } },
  );
  return (data.matches ?? []).map((m) => ({
    externalId: String(m.id),
    competition: m.competition.code,
    homeTeam: m.homeTeam.name,
    awayTeam: m.awayTeam.name,
    homeScore: m.score.fullTime.home,
    awayScore: m.score.fullTime.away,
    status: m.status,
    utcDate: new Date(m.utcDate),
  }));
}
