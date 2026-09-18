import type { Connector } from './types';
import { googleNews } from './googlenews';
import { gdelt } from './gdelt';
import { reddit } from './reddit';
import { bluesky } from './bluesky';
import { mastodon } from './mastodon';
import { hackerNews } from './hackernews';
import { youtube } from './youtube';
import { xTwitter } from './x';
import { telegram } from './telegram';
import { rss } from './rss';
import { instagram } from './instagram';
import { facebook } from './facebook';
import { tiktok } from './tiktok';
import { linkedin } from './linkedin';
import { linkedinWeb } from './linkedin-web';
import { newsapi } from './newsapi';
import { stackExchange } from './stackexchange';
import { github } from './github';
import { discord } from './discord';
import { secEdgar } from './sec-edgar';
import { arxiv } from './arxiv';
import { talkwalker } from './talkwalker';
import { lemmy } from './lemmy';
import { newsdata } from './newsdata';
import { podcastIndex } from './podcastindex';

export const CONNECTORS: Connector[] = [
  // Free / public adapters
  googleNews, gdelt, reddit, bluesky, mastodon, hackerNews, youtube, telegram, rss, linkedinWeb,
  stackExchange, github, discord, secEdgar, arxiv, lemmy, newsdata, podcastIndex,
  // Commercial / Routed (Powered by Muapi or BYOK direct)
  xTwitter, instagram, facebook, tiktok, linkedin, newsapi, talkwalker,
];

export type MentionKind = 'article' | 'post';
export const SOURCE_KIND: Record<string, MentionKind> = {
  googlenews: 'article', gdelt: 'article', newsapi: 'article', rss: 'article', upload: 'article', 'sec-edgar': 'article',
  reddit: 'post', bluesky: 'post', mastodon: 'post', hackernews: 'post', youtube: 'post',
  x: 'post', telegram: 'post', instagram: 'post', facebook: 'post', tiktok: 'post',
  linkedin: 'post', linkedin_web: 'post', stackexchange: 'post', github: 'post', discord: 'post',
  arxiv: 'article', talkwalker_news: 'article', talkwalker: 'post',
  lemmy: 'post', newsdata: 'article', podcastindex: 'article',
};

export const kindOf = (source: string): MentionKind => SOURCE_KIND[source] ?? 'post';

export type SourceCategory = 'general' | 'tech' | 'social' | 'video' | 'audio' | 'finance' | 'academic';
export const SOURCE_CATEGORY: Record<string, SourceCategory> = {
  googlenews: 'general', gdelt: 'general', newsapi: 'general', rss: 'general',
  hackernews: 'tech', stackexchange: 'tech', github: 'tech',
  reddit: 'social', bluesky: 'social', mastodon: 'social', x: 'social',
  instagram: 'social', facebook: 'social', tiktok: 'social', telegram: 'social',
  discord: 'social', linkedin: 'social', linkedin_web: 'social',
  youtube: 'video',
  'sec-edgar': 'finance',
  arxiv: 'academic', talkwalker: 'social', talkwalker_news: 'general',
  lemmy: 'social', newsdata: 'general', podcastindex: 'audio',
};

export const CATEGORY_ORDER: SourceCategory[] = ['general', 'finance', 'academic', 'tech', 'social', 'video', 'audio'];
export const CATEGORY_LABEL: Record<SourceCategory, string> = {
  general: 'General & News', finance: 'Financial & Corporate', academic: 'Academic',
  tech: 'Tech & Developer', social: 'Social & Messaging', video: 'Video', audio: 'Podcasts & Audio',
};

export const NEWS_SOURCES = Object.entries(SOURCE_KIND)
  .filter(([id, k]) => k === 'article' && id !== 'upload')
  .map(([id]) => id);

export const SOURCE_META: Record<string, { label: string; color: string; note?: string }> = {
  googlenews: { label: 'Google News', color: '#f59e0b', note: 'Keywords and publisher news via Muapi reputation.news_search or direct RSS.' },
  gdelt: { label: 'GDELT', color: '#a78bfa', note: 'Worldwide news coverage with country and language classification.' },
  reddit: { label: 'Reddit', color: '#ff4500', note: 'Subreddit and community keyword monitoring via Muapi or Reddit script OAuth.' },
  bluesky: { label: 'Bluesky', color: '#38bdf8', note: 'Public posts from the open AT Protocol network.' },
  mastodon: { label: 'Mastodon', color: '#8b5cf6', note: 'Federated microblogging hashtag discovery.' },
  hackernews: { label: 'Hacker News', color: '#f97316', note: 'Tech discussions and story comments via Algolia.' },
  youtube: { label: 'YouTube', color: '#ef4444', note: 'Video titles, descriptions, and engagement metrics.' },
  x: { label: 'X (Twitter)', color: '#e2e8f0', note: 'Real-time keyword and post search via Muapi or X API v2.' },
  telegram: { label: 'Telegram', color: '#29b6f6', note: 'Watchlist stream for public news and company channels.' },
  rss: { label: 'RSS', color: '#fbbf24', note: 'User-configured RSS and Atom feeds.' },
  instagram: { label: 'Instagram', color: '#e1306c', note: 'Hashtag media and brand mentions via Muapi or Meta Graph API.' },
  facebook: { label: 'Facebook', color: '#1877f2', note: 'Monitored company and community Facebook pages.' },
  tiktok: { label: 'TikTok', color: '#fe2c55', note: 'Trending hashtag and keyword video posts.' },
  linkedin: { label: 'LinkedIn (page)', color: '#0a66c2', note: 'Posts and commentary from your own company page.' },
  linkedin_web: { label: 'LinkedIn (web)', color: '#4c9ce8', note: 'Public professional articles and discussions.' },
  newsapi: { label: 'NewsAPI', color: '#14b8a6', note: 'Global press collection from 150,000+ sources.' },
  newsdata: { label: 'NewsData.io', color: '#6366f1', note: 'Multilingual news coverage from 100,000+ news outlets.' },
  stackexchange: { label: 'Stack Exchange', color: '#f48024', note: 'Developer discussions across Stack Overflow and sister sites.' },
  github: { label: 'GitHub', color: '#cbd5e1', note: 'Public issues and pull requests matching query terms.' },
  discord: { label: 'Discord', color: '#5865f2', note: 'Internal community discussion from administered Discord servers.' },
  'sec-edgar': { label: 'SEC EDGAR', color: '#2c5aa0', note: 'Official 8-K, 10-K, and 10-Q corporate regulatory filings.' },
  arxiv: { label: 'arXiv', color: '#b31b1b', note: 'Computer science, physics, and AI academic research papers.' },
  lemmy: { label: 'Lemmy', color: '#6366f1', note: 'Federated link-aggregator and discussion communities.' },
  podcastindex: { label: 'Podcast Index', color: '#f43f5e', note: 'Audio podcast episode titles and shownotes.' },
  talkwalker: { label: 'Talkwalker', color: '#00b8a9', note: 'Enterprise social listening topics and Lumen archive documents.' },
  talkwalker_news: { label: 'Talkwalker (news)', color: '#0d9488', note: 'Editorial articles from enterprise Talkwalker projects.' },
};
