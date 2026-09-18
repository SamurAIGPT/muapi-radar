import type { DB } from './index';
import * as schema from './schema';
import { validatePlan, type QueryPlan } from '@/lib/query-plan';

export const DEMO_BRIEF =
  'Monitor the company Aurora Mobility in relation to the riders’ strike and to city bans on e-scooters, and against its competitors Volta Ride, Ruota and Metrolink.';

export const DEMO_PLAN: QueryPlan = validatePlan({
  version: 1,
  brief: DEMO_BRIEF,
  origin: 'ai',
  concepts: [
    { id: 'aurora', label: 'Aurora Mobility', role: 'subject', terms: ['Aurora Mobility', 'Aurora scooters', 'Aurora e-bikes', 'Aurora app'], note: 'Official name, the two product lines and the app people talk about.' },
    { id: 'strike', label: 'Riders’ strike', role: 'context', terms: ['riders strike', 'rider strike', 'walkout', 'picket', 'sciopero dei rider', 'sciopero', 'presidio', 'protesta'], note: 'The strike as people actually write it, in English and Italian.' },
    { id: 'bans', label: 'City bans', role: 'context', terms: ['e-scooter ban', 'scooter ban', 'city council', 'speed limit', 'divieto monopattini', 'consiglio comunale', 'limite di velocità'], note: 'Local rules that can stop the service.' },
    { id: 'volta', label: 'Volta Ride', role: 'competitor', terms: ['Volta Ride', 'Volta scooters'] },
    { id: 'ruota', label: 'Ruota', role: 'competitor', terms: ['Ruota bike', 'Ruota app', 'Ruota'], note: '“Ruota” is also the Italian word for wheel: see the exclusions.' },
    { id: 'metrolink', label: 'Metrolink', role: 'competitor', terms: ['Metrolink Mobility', 'Metrolink shuttle'] },
    { id: 'noise', label: 'Everyday meanings', role: 'noise', terms: ['aurora borealis', 'aurora boreale', 'ruota di scorta', 'ruota panoramica'], note: '“Aurora” and “Ruota” are everyday words: these phrases mark the wrong meaning.' },
  ],
  queries: [
    { id: 'aurora', name: 'Aurora Mobility', kind: 'core', all: ['aurora'], none: ['noise'] },
    { id: 'aurora-strike', name: 'Aurora × riders’ strike', kind: 'context', all: ['aurora', 'strike'], none: ['noise'] },
    { id: 'aurora-bans', name: 'Aurora × city bans', kind: 'context', all: ['aurora', 'bans'], none: ['noise'] },
    { id: 'aurora-volta', name: 'Aurora vs Volta Ride', kind: 'comparison', all: ['aurora', 'volta'], none: ['noise'] },
    { id: 'volta', name: 'Volta Ride', kind: 'competitor', all: ['volta'] },
    { id: 'ruota', name: 'Ruota', kind: 'competitor', all: ['ruota'], none: ['noise'] },
    { id: 'metrolink', name: 'Metrolink', kind: 'competitor', all: ['metrolink'] },
  ],
}).plan;

export async function seedDemoExtra(db: DB) {
  // Configures additional listening projects without inserting any mock/fake mentions.
  const [aurora] = await db.insert(schema.projects).values({
    name: 'Aurora Mobility', mode: 'listening', visibility: 'shared', ownerId: 1,
    keywords: ['Aurora Mobility', 'Aurora scooters', 'Aurora e-bikes', 'Aurora app', 'riders strike', 'e-scooter ban', 'Volta Ride', 'Ruota bike', 'Metrolink Mobility'],
    excludeTerms: ['aurora borealis', 'aurora boreale', 'ruota di scorta', 'ruota panoramica'],
    languages: ['en', 'it'], countries: ['IT', 'GB'],
    semanticContext: DEMO_BRIEF,
    queryPlan: DEMO_PLAN,
  }).returning();

  await db.insert(schema.benchmarkEntities).values([
    { projectId: aurora.id, name: 'Aurora Mobility', keywords: ['Aurora Mobility', 'Aurora scooters', 'Aurora e-bikes'], isOwnBrand: 1 },
    { projectId: aurora.id, name: 'Volta Ride', keywords: ['Volta Ride', 'Volta scooters'] },
    { projectId: aurora.id, name: 'Ruota', keywords: ['Ruota bike', 'Ruota app'] },
    { projectId: aurora.id, name: 'Metrolink', keywords: ['Metrolink Mobility', 'Metrolink shuttle'] },
  ]);

  return aurora.id;
}
