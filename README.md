# Muapi Radar — Autonomous Media Intelligence & Social Listening

<p align="center">
  <strong>Real-time social listening, media intelligence, competitive benchmarking, and AI-driven narrative analytics.</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#data-sources">Data Sources</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#mcp-server">MCP Server</a> •
  <a href="#testing">Testing</a>
</p>

---

## Overview

**Muapi Radar** is an enterprise-grade media intelligence platform designed to track brands, entities, competitors, and emerging narratives across public networks and commercial news APIs in real time. 

Built with **Next.js (App Router)**, **Drizzle ORM**, **PGlite / PostgreSQL**, and a multi-provider AI analytics engine, Muapi Radar ingests live signals, computes sentiment and volume trends, and generates actionable executive briefs without synthetic or mock data.

---

## Features

- **100% Real-Time Ingestion**: Direct connectors to live news feeds, social platforms, code commits, and academic preprints. Zero fake or PRNG-generated mentions.
- **Unified Brand & Competitive Benchmarking**: Compare entities (e.g. OpenAI, Anthropic, Google, Meta) by **Share of Voice (SOV)**, search volume index, and sentiment trajectory.
- **Anomaly & Spike Alerts**: Real-time detection of volume surges and sentiment drops with automated push notifications.
- **Daily Executive AI Briefs**: Automatic summarization of breaking narratives, key topics, and emergent risks powered by LLMs (Claude, GPT, Grok).
- **Studio Graph & Custom Dashboards**: Query, filter, and visualize mentions across custom dimensions, timeframes, and platforms.
- **Model Context Protocol (MCP)**: Native `/api/mcp` endpoint allowing AI assistants (Claude Desktop, Cursor, Copilot) to query your live media intelligence database.
- **Embedded or Cloud Database**: Zero-configuration embedded PGlite for local execution, or scalable serverless Postgres (Neon / Supabase) for production.
- **Minimal, Modern Design**: Fast, responsive, dark-mode-first aesthetic inspired by Linear and Vercel.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Data Ingestion Layer                            │
│  Muapi APIs  │  Bluesky AT  │  Google News  │  Mastodon  │  arXiv etc  │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      Core Pipeline & Processing                        │
│   • Deduplication & Cleaning          • Entity Linking                 │
│   • Search Interest Indexing          • Wikipedia Revisions            │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         Storage & Database                             │
│       PostgreSQL / PGlite (Drizzle ORM) • Mentions, Alerts, Briefs     │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                  Analytics, AI & Delivery Surfaces                     │
│  • Web Dashboard (Next.js 16)         • Executive AI Daily Briefs      │
│  • Studio Visualization Graphs        • Model Context Protocol (MCP)   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Data Sources

Muapi Radar unifies commercial and open public feeds into a single pipeline:

| Category | Sources & Connectors |
| :--- | :--- |
| **Commercial Media & Social** | **Muapi API** (`news-search`, `social-search-posts`, `seo-keyword-trends`) |
| **Breaking News** | **Google News RSS**, **GDELT Project**, **NewsAPI**, **NewsData** |
| **Decentralized & Social** | **Bluesky** (AT Protocol public firehose), **Mastodon** (Fediverse instances) |
| **Community Discussions** | **Hacker News**, **Lemmy**, **Reddit**, **Discord**, **Telegram** |
| **Code & Technical Preprints** | **GitHub** (commits & pull requests), **arXiv** (scientific papers) |
| **Regulatory & Business** | **SEC EDGAR** (corporate filings & 8-K disclosures), **Wikipedia** (page revisions) |
| **Consumer Reviews** | **Google Places**, **Apple App Store**, **Yelp** |
| **Podcasts & Audio** | **Podcast Index** (episode transcripts & show notes) |

---

## Quick Start

### Prerequisites
- **Node.js**: v20.x or higher
- **npm** or **pnpm**

### 1. Clone & Install

```bash
git clone https://github.com/SamurAIGPT/muapi-radar.git
cd muapi-radar
npm install
```

### 2. Configure Environment

Copy the example configuration:

```bash
cp .env.example .env.local
```

Set your credentials in `.env.local`:

```env
# Core app settings
SESSION_SECRET=your-random-32-character-secret
APP_URL=http://localhost:3000

# Muapi API Credentials
MUAPI_API_KEY=your_muapi_api_key_here
MUAPI_BASE_URL=https://api.muapi.ai/api/v1

# Optional AI Analysis (BYOK: Claude, OpenAI, or Grok)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
API_BUDGET_USD=25
```

> **Note**: For local development, `DATABASE_URL` can be left blank. Muapi Radar will automatically use an embedded PGlite database stored in `.data/pglite`.

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Live Ingestion & Pipeline

To trigger real-time data ingestion across all enabled connectors:

- **Via Dashboard**: Click the **Refresh** button in the top navigation bar.
- **Via API**:
  ```bash
  curl -X POST http://localhost:3000/api/refresh
  ```
- **Automated Cron**: Deploy with a scheduled job invoking `/api/cron/daily` with your configured `CRON_SECRET`.

---

## Configuration

Key environment variables in `.env.local`:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `DATABASE_URL` | Postgres URI. If omitted, uses embedded PGlite. | `""` (embedded) |
| `SESSION_SECRET` | 32-character secret for signing session cookies. | Required |
| `MUAPI_API_KEY` | Your Muapi platform API key. | Required for Muapi |
| `MUAPI_BASE_URL` | Base endpoint for Muapi APIs. | `https://api.muapi.ai/api/v1` |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key for AI briefs & classification. | Optional |
| `OPENAI_API_KEY` | OpenAI API key alternative. | Optional |
| `API_BUDGET_USD` | Monthly spend ceiling in USD for AI API calls. | `25` |
| `RADAR_MCP_TOKEN` | Bearer token protecting the MCP server endpoint. | Optional |

---

## MCP Server (Model Context Protocol)

Muapi Radar includes a built-in MCP server at `/api/mcp`. You can connect Claude Desktop or Cursor to query your live media intelligence database.

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "muapi-radar": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote-client",
        "http://localhost:3000/api/mcp",
        "--header",
        "Authorization: Bearer YOUR_RADAR_MCP_TOKEN"
      ]
    }
  }
}
```

### Supported MCP Tools
- `get_project_summary`: Fetch top KPIs, volume, and sentiment for active projects.
- `search_mentions`: Full-text search across live ingested mentions by keyword, source, or sentiment.
- `get_alerts`: Retrieve unacknowledged volume spikes and sentiment alerts.
- `get_daily_brief`: Read the latest executive AI brief.

---

## Testing

Muapi Radar includes a comprehensive test suite covering connectors, data normalization, query plan generation, and AI fallback behavior:

```bash
npm test
```

```
ℹ tests 194
ℹ pass 194
ℹ fail 0
```

---

## License

This project is licensed under the [MIT License](LICENSE).
