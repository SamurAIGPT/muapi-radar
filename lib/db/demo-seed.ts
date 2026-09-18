import type { DB } from '@/lib/db';
import * as schema from './schema';

/**
 * Initializes the default production/monitoring project without any mock or fake data.
 * All mentions, topics, trends, and briefs are collected live in real-time from
 * Muapi API endpoints and active network connectors.
 */
export async function seedDemo(db: DB) {
  const existing = await db.select({ id: schema.projects.id }).from(schema.projects).limit(1);
  if (existing.length > 0) return;

  const [project] = await db.insert(schema.projects).values({
    name: 'Artificial Intelligence',
    keywords: ['artificial intelligence', 'generative AI', 'LLM'],
    languages: ['en'],
    visibility: 'shared',
    ownerId: 1,
    semanticContext: 'The global AI industry: model releases, regulation, chips, funding, safety and enterprise adoption.',
    brandVoice: 'Clear, credible and concise; informed but not hyped.',
  }).returning();

  const pid = project.id;

  await db.insert(schema.benchmarkEntities).values([
    { projectId: pid, name: 'OpenAI', keywords: ['OpenAI', 'ChatGPT', 'GPT'] },
    { projectId: pid, name: 'Anthropic', keywords: ['Anthropic', 'Claude'], isOwnBrand: 1 },
    { projectId: pid, name: 'Google', keywords: ['Gemini', 'DeepMind'] },
    { projectId: pid, name: 'Meta', keywords: ['Meta AI', 'Llama'] },
  ]);
}
