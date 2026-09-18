import {
  pgTable, serial, text, integer, real, jsonb, timestamp, date,
} from 'drizzle-orm/pg-core';

export type Engagement = {
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
};

export type Quality = {
  score: number;
  relevance: number;
  virality: number;
  risk: 'low' | 'medium' | 'high';
  note?: string;
};

export type KeyMessage = {
  id: string;
  text: string;
  terms: string[];
};

export type ConceptBlock = {
  id: string;
  label: string;
  role: 'subject' | 'context' | 'competitor' | 'noise';
  terms: string[];
  note?: string;
};

export type QueryDefinition = {
  id: string;
  name: string;
  kind: 'core' | 'context' | 'competitor' | 'comparison' | 'custom';
  all: string[];
  none?: string[];
  enabled?: boolean;
};

export type QueryPlan = {
  brief?: string;
  origin?: 'ai' | 'rules' | 'legacy' | 'manual';
  concepts: ConceptBlock[];
  queries: QueryDefinition[];
};

// ---------------------------------------------------------------------------
// 1. Users & Administration
// ---------------------------------------------------------------------------
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('member'), // 'admin' | 'member'
  aiEnabled: integer('ai_enabled').notNull().default(0),
  mustChangePassword: integer('must_change_password').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 2. Projects & Queries
// ---------------------------------------------------------------------------
export const projects = pgTable('projects', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  mode: text('mode').notNull().default('listening'), // 'listening' | 'upload' | 'talkwalker'
  talkwalkerProject: text('talkwalker_project'),
  talkwalkerTopics: jsonb('talkwalker_topics').$type<string[]>().notNull().default([]),
  evidenceTerms: jsonb('evidence_terms').$type<string[]>().notNull().default([]),
  queryPlan: jsonb('query_plan').$type<QueryPlan>(),
  ownerId: integer('owner_id'),
  visibility: text('visibility').notNull().default('private'), // 'private' | 'shared'
  keywords: jsonb('keywords').$type<string[]>().notNull().default([]),
  allTerms: jsonb('all_terms').$type<string[]>().notNull().default([]),
  excludeTerms: jsonb('exclude_terms').$type<string[]>().notNull().default([]),
  languages: jsonb('languages').$type<string[]>().notNull().default([]),
  countries: jsonb('countries').$type<string[]>().notNull().default([]),
  keyMessages: jsonb('key_messages').$type<KeyMessage[]>().notNull().default([]),
  telegramChannels: jsonb('telegram_channels').$type<string[]>().notNull().default([]),
  rssFeeds: jsonb('rss_feeds').$type<string[]>().notNull().default([]),
  brandVoice: text('brand_voice'),
  semanticContext: text('semantic_context'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const benchmarkEntities = pgTable('benchmark_entities', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  name: text('name').notNull(),
  keywords: jsonb('keywords').$type<string[]>().notNull().default([]),
  isOwnBrand: integer('is_own_brand').notNull().default(0),
});

// ---------------------------------------------------------------------------
// 3. Mentions & Intelligence
// ---------------------------------------------------------------------------
export const mentions = pgTable('mentions', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  source: text('source').notNull(),
  externalId: text('external_id').notNull(),
  url: text('url'),
  title: text('title'),
  content: text('content').notNull().default(''),
  kind: text('kind').$type<'article' | 'post'>().notNull().default('post'),
  articleText: text('article_text'),
  articleAt: timestamp('article_at', { withTimezone: true }),
  author: text('author'),
  authorHandle: text('author_handle'),
  community: text('community'),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  language: text('language'),
  country: text('country'),
  engagement: jsonb('engagement').$type<Engagement>(),
  engagementScore: real('engagement_score').notNull().default(0),
  reach: integer('reach'),
  sentiment: text('sentiment'), // 'positive' | 'neutral' | 'negative'
  sentimentScore: real('sentiment_score'), // -1.0 to 1.0
  emotion: text('emotion'), // joy, trust, fear, anger, sadness, surprise
  relevance: integer('relevance'), // 1-5
  relevanceReason: text('relevance_reason'),
  translations: jsonb('translations').$type<Record<string, { title?: string; content: string }>>(),
  topics: jsonb('topics').$type<string[]>(),
  entities: jsonb('entities').$type<string[]>(),
  quality: jsonb('quality').$type<Quality>(),
  custom: jsonb('custom').$type<Record<string, string>>(),
  queryIds: jsonb('query_ids').$type<string[]>().notNull().default([]),
  analyzedAt: timestamp('analyzed_at', { withTimezone: true }),
  storyId: integer('story_id'),
  importFileId: integer('import_file_id'),
});

export const stories = pgTable('stories', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  title: text('title').notNull(),
  summary: text('summary'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const alerts = pgTable('alerts', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  type: text('type').notNull(), // volume_spike, negative_spike, influencer, competitor_spike
  severity: text('severity').notNull().default('media'), // bassa, media, alta, critica
  message: text('message').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const briefs = pgTable('briefs', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  briefDate: date('brief_date').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const trends = pgTable('trends', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  topic: text('topic').notNull(),
  n24: integer('n24').notNull(),
  baseline: real('baseline').notNull(),
  score: real('score').notNull(),
  explanation: text('explanation'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const narratives = pgTable('narratives', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  stance: text('stance'),
  coordinated: integer('coordinated').notNull().default(0),
  accounts: jsonb('accounts').$type<string[]>().notNull().default([]),
  mentionIds: jsonb('mention_ids').$type<number[]>().notNull().default([]),
  mentionCount: integer('mention_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const influencerProfiles = pgTable('influencer_profiles', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  author: text('author').notNull(),
  source: text('source').notNull(),
  profileMd: text('profile_md').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const contentIdeas = pgTable('content_ideas', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  contentMd: text('content_md').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const shareLinks = pgTable('share_links', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  token: text('token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const timelineEvents = pgTable('timeline_events', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  eventDate: date('event_date').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  importance: integer('importance').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 4. Reviews & Multi-Platform Feedback
// ---------------------------------------------------------------------------
export const reviewSources = pgTable('review_sources', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  type: text('type').notNull(), // 'appstore' | 'googleplaces' | 'yelp' | 'upload'
  identifier: text('identifier').notNull(),
  label: text('label').notNull(),
  country: text('country'),
  lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reviews = pgTable('reviews', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  sourceId: integer('source_id').notNull(),
  externalId: text('external_id').notNull(),
  rating: integer('rating').notNull(), // 1-5
  title: text('title'),
  content: text('content').notNull().default(''),
  author: text('author'),
  url: text('url'),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 5. Sports, Stocks & Search Interest
// ---------------------------------------------------------------------------
export const sportSources = pgTable('sport_sources', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  competition: text('competition').notNull(),
  teamId: text('team_id').notNull(),
  teamName: text('team_name').notNull(),
  ticker: text('ticker'),
  lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sportMatches = pgTable('sport_matches', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  sourceId: integer('source_id').notNull(),
  externalId: text('external_id').notNull(),
  competition: text('competition').notNull(),
  homeTeam: text('home_team').notNull(),
  awayTeam: text('away_team').notNull(),
  homeScore: integer('home_score'),
  awayScore: integer('away_score'),
  status: text('status').notNull(),
  utcDate: timestamp('utc_date', { withTimezone: true }).notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

export const stockPrices = pgTable('stock_prices', {
  id: serial('id').primaryKey(),
  ticker: text('ticker').notNull(),
  date: date('date').notNull(),
  close: real('close').notNull(),
  changePct: real('change_pct'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

export const searchInterest = pgTable('search_interest', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id').notNull(),
  date: date('date').notNull(),
  value: integer('value').notNull(), // 0-100
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 6. Wikipedia Monitoring
// ---------------------------------------------------------------------------
export const wikiPages = pgTable('wiki_pages', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  title: text('title').notNull(),
  lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const wikiEdits = pgTable('wiki_edits', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  pageId: integer('page_id').notNull(),
  revId: integer('rev_id').notNull(),
  user: text('user').notNull(),
  isAnon: integer('is_anon').notNull().default(0),
  isMinor: integer('is_minor').notNull().default(0),
  comment: text('comment').notNull().default(''),
  size: integer('size').notNull(),
  sizeDiff: integer('size_diff'),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 7. Import Workspace & Metric Points
// ---------------------------------------------------------------------------
export const importFiles = pgTable('import_files', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  filename: text('filename').notNull(),
  sizeBytes: integer('size_bytes').notNull().default(0),
  rowCount: integer('row_count').notNull().default(0),
  columns: jsonb('columns').$type<string[]>().notNull().default([]),
  profiles: jsonb('profiles').$type<unknown[]>().notNull().default([]),
  proposal: jsonb('proposal').$type<unknown[]>(),
  mapping: jsonb('mapping').$type<Record<string, string>>().notNull().default({}),
  status: text('status').$type<'uploaded' | 'mapped' | 'imported'>().notNull().default('uploaded'),
  report: jsonb('report').$type<Record<string, number>>(),
  rawPurged: integer('raw_purged').notNull().default(0),
  usedAi: integer('used_ai').notNull().default(0),
  issues: jsonb('issues').$type<Record<string, number>>(),
  sheetName: text('sheet_name'),
  kind: text('kind').$type<'mentions' | 'metrics'>().notNull().default('mentions'),
  archetype: text('archetype'),
  constants: jsonb('constants').$type<Record<string, string>>().notNull().default({}),
  people: integer('people').notNull().default(0),
  metricMap: jsonb('metric_map').$type<Record<string, unknown>>(),
  extras: jsonb('extras').$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  importedAt: timestamp('imported_at', { withTimezone: true }),
});

export const importRows = pgTable('import_rows', {
  id: serial('id').primaryKey(),
  fileId: integer('file_id').notNull(),
  rowIndex: integer('row_index').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
});

export const metricPoints = pgTable('metric_points', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  importFileId: integer('import_file_id'),
  entity: text('entity').notNull(),
  metric: text('metric').notNull(),
  date: timestamp('date', { withTimezone: true }).notNull(),
  value: real('value').notNull(),
  dims: jsonb('dims').$type<Record<string, string>>().notNull().default({}),
});

// ---------------------------------------------------------------------------
// 8. Studio Graph & Reporting
// ---------------------------------------------------------------------------
export const studioCharts = pgTable('studio_charts', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  title: text('title').notNull(),
  spec: jsonb('spec').$type<Record<string, unknown>>().notNull(),
  comment: text('comment'),
  commentAt: timestamp('comment_at', { withTimezone: true }),
  commentFor: text('comment_for'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const customReports = pgTable('custom_reports', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  title: text('title').notNull(),
  days: integer('days').notNull().default(30),
  pages: jsonb('pages').$type<unknown[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const periodicReports = pgTable('periodic_reports', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  cadence: text('cadence').notNull(), // daily, weekly, biweekly, monthly, quarterly, annual
  periodStart: text('period_start').notNull(),
  periodEnd: text('period_end').notNull(),
  pages: jsonb('pages').$type<unknown[]>().notNull().default([]),
  provenance: jsonb('provenance').$type<Record<string, unknown>>(),
  pov: jsonb('pov').$type<unknown>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 9. Fact Checks & Clinical Trials
// ---------------------------------------------------------------------------
export type FactReview = {
  publisher: string;
  site?: string;
  url: string;
  title?: string;
  reviewDate?: string;
  rating: string;
  language?: string;
};

export type Circulation = {
  total: number;
  last7: number;
  prev7: number;
  sources: Record<string, number>;
  sampleIds: number[];
  lastSeen: string | null;
  terms: string[];
  at: string;
};

export const factChecks = pgTable('fact_checks', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  claimKey: text('claim_key').notNull(),
  claim: text('claim').notNull(),
  claimant: text('claimant'),
  claimDate: timestamp('claim_date', { withTimezone: true }),
  reviews: jsonb('reviews').$type<FactReview[]>().notNull().default([]),
  verdict: text('verdict').notNull(), // false, misleading, mixed, true, unverifiable, other
  language: text('language'),
  query: text('query').notNull(),
  firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
  circulation: jsonb('circulation').$type<Circulation>(),
});

export type TrialNews = {
  total: number;
  last30: number;
  sampleIds: number[];
  terms: string[];
  at: string;
  byTerm?: Record<string, { total: number; last30: number; sampleIds: number[] }>;
};

export const clinicalTrials = pgTable('clinical_trials', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  nctId: text('nct_id').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull(),
  phases: jsonb('phases').$type<string[]>().notNull().default([]),
  studyType: text('study_type'),
  sponsor: text('sponsor'),
  sponsorClass: text('sponsor_class'),
  conditions: jsonb('conditions').$type<string[]>().notNull().default([]),
  interventions: jsonb('interventions').$type<{ type: string; name: string }[]>().notNull().default([]),
  enrollment: integer('enrollment'),
  startDate: text('start_date'),
  completionDate: text('completion_date'),
  firstPosted: text('first_posted'),
  lastUpdate: text('last_update'),
  hasResults: integer('has_results').notNull().default(0),
  countries: jsonb('countries').$type<string[]>().notNull().default([]),
  query: text('query').notNull(),
  news: jsonb('news').$type<TrialNews>(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 10. Operations, Meta & Usage
// ---------------------------------------------------------------------------
export const apiUsage = pgTable('api_usage', {
  id: serial('id').primaryKey(),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  model: text('model').notNull(),
  purpose: text('purpose').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  costUsd: real('cost_usd').notNull().default(0),
});

export const meta = pgTable('meta', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>(),
});
