import { cfg } from '@/lib/connector-config';
import type { RawMention } from '@/lib/connectors/types';

export interface MuapiTaskResponse {
  task_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
}

export interface MuapiStatusInfo {
  lastCalledAt: string;
  endpoint: string;
  requestId?: string;
  status: 'ok' | 'failed' | 'queued' | 'empty';
  error?: string;
  detail?: string;
}

export async function getLatestMuapiStatus(): Promise<MuapiStatusInfo | null> {
  try {
    const { getMeta } = await import('@/lib/db');
    return (await getMeta<MuapiStatusInfo>('muapi_last_status')) ?? null;
  } catch {
    return null;
  }
}

export async function recordMuapiStatus(info: MuapiStatusInfo) {
  try {
    const { setMeta } = await import('@/lib/db');
    await setMeta('muapi_last_status', info);
  } catch (e) {
    console.warn('[muapi-client] Failed recording status:', e);
  }
}

export function isMuapiConfigured(): boolean {
  const key = cfg('MUAPI_API_KEY') || process.env.MUAPI_API_KEY;
  return Boolean(key && key.trim().length > 0);
}

export function getMuapiBaseUrl(): string {
  return cfg('MUAPI_BASE_URL') || process.env.MUAPI_BASE_URL || 'https://api.muapi.ai/api/v1';
}

/**
 * Execute capability through Muapi API.
 * Supports synchronous response or async task polling.
 */
export async function executeMuapiCapability<T = unknown>(
  endpoint: string,
  payload: Record<string, unknown>,
  timeoutMs: number = 25000,
): Promise<T | null> {
  const apiKey = cfg('MUAPI_API_KEY') || process.env.MUAPI_API_KEY;
  if (!apiKey) return null;

  const rawBase = getMuapiBaseUrl().replace(/\/$/, '');
  const cleanEp = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  // If base doesn't include /api/v1 and endpoint doesn't either, insert /api/v1
  const url = (!rawBase.includes('/api/v1') && !cleanEp.startsWith('/api/v1'))
    ? `${rawBase}/api/v1${cleanEp}`
    : `${rawBase}${cleanEp}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[muapi-client] ${endpoint} returned status ${res.status}: ${errText.slice(0, 200)}`);
      await recordMuapiStatus({
        lastCalledAt: new Date().toISOString(),
        endpoint,
        status: 'failed',
        error: `HTTP ${res.status}: ${errText.slice(0, 200) || res.statusText}`,
      });
      return null;
    }

    const data = await res.json() as {
      task_id?: string;
      request_id?: string;
      status?: string;
      result?: T;
      output?: T;
      items?: T;
      posts?: T;
      articles?: T;
      data?: T;
    };

    // If it's an immediate result:
    if (data.result !== undefined) return data.result;
    if (data.output !== undefined) return data.output;
    if (data.items !== undefined) return data.items as T;
    if (data.posts !== undefined) return data.posts as T;
    if (data.articles !== undefined) return data.articles as T;
    if (data.data !== undefined) return data.data as T;

    // If it's an asynchronous task/prediction:
    const asyncId = data.request_id || data.task_id;
    if (asyncId) {
      console.log(`[muapi-client] Queued ${endpoint} with request_id: ${asyncId}`);
      await recordMuapiStatus({
        lastCalledAt: new Date().toISOString(),
        endpoint,
        requestId: asyncId,
        status: 'queued',
        detail: `Queued on Muapi (${asyncId}). Waiting for worker execution...`,
      });
      return await pollMuapiTask<T>(asyncId, timeoutMs, endpoint);
    }

    await recordMuapiStatus({
      lastCalledAt: new Date().toISOString(),
      endpoint,
      status: 'ok',
    });
    return data as unknown as T;
  } catch (err) {
    console.error(`[muapi-client] Failed calling ${endpoint}:`, err);
    await recordMuapiStatus({
      lastCalledAt: new Date().toISOString(),
      endpoint,
      status: 'failed',
      error: (err as Error)?.message ?? String(err),
    });
    return null;
  }
}

export async function pollMuapiTask<T>(taskId: string, timeoutMs: number = 30000, endpoint: string = '/predictions'): Promise<T | null> {
  const apiKey = cfg('MUAPI_API_KEY') || process.env.MUAPI_API_KEY;
  if (!apiKey) return null;

  const baseUrl = getMuapiBaseUrl().replace(/\/$/, '');
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      // First try standard Muapi prediction polling endpoint
      let res = await fetch(`${baseUrl}/predictions/${taskId}/result`, {
        headers: {
          'x-api-key': apiKey,
          Authorization: `Bearer ${apiKey}`,
        },
      });

      // If not found, try task endpoint
      if (res.status === 404) {
        res = await fetch(`${baseUrl}/tasks/${taskId}`, {
          headers: {
            'x-api-key': apiKey,
            Authorization: `Bearer ${apiKey}`,
          },
        });
      }

      if (!res.ok && res.status !== 400) continue;

      const body = await res.json() as {
        status?: string;
        output?: unknown;
        result?: unknown;
        error?: string;
        detail?: { status?: string; error?: string; output?: unknown };
      };

      const status = body.status ?? body.detail?.status;
      if (status === 'completed') {
        const rawRes = (body.output ?? body.result ?? body.detail?.output ?? body) as T;
        const count = Array.isArray(rawRes)
          ? rawRes.length
          : (rawRes && typeof rawRes === 'object' && Array.isArray((rawRes as Record<string, unknown>).items))
            ? ((rawRes as Record<string, unknown>).items as unknown[]).length
            : 0;
        await recordMuapiStatus({
          lastCalledAt: new Date().toISOString(),
          endpoint,
          requestId: taskId,
          status: count > 0 ? 'ok' : 'empty',
          detail: count > 0 ? `${count} mentions retrieved` : '0 mentions matched the current query keywords',
        });
        return rawRes;
      }
      if (status === 'failed') {
        const errMsg = body.error ?? body.detail?.error ?? 'Unknown error';
        console.warn(`[muapi-client] Task ${taskId} failed:`, errMsg);
        await recordMuapiStatus({
          lastCalledAt: new Date().toISOString(),
          endpoint,
          requestId: taskId,
          status: 'failed',
          error: String(errMsg),
        });
        return null;
      }
    } catch (e) {
      console.warn(`[muapi-client] Polling error for task ${taskId}:`, e);
    }
  }

  console.warn(`[muapi-client] Task ${taskId} timed out after ${timeoutMs}ms`);
  await recordMuapiStatus({
    lastCalledAt: new Date().toISOString(),
    endpoint,
    requestId: taskId,
    status: 'failed',
    error: `Task timed out after ${timeoutMs / 1000}s on Muapi worker`,
  });
  return null;
}

/**
 * Normalizes generic Muapi social/news items into RawMention contract.
 */
export function normalizeMuapiMention(item: Record<string, unknown>, fallbackSource: string): RawMention {
  const externalId = String(item.id || item.external_id || item.post_id || item.url || Math.random().toString(36).slice(2));
  const publishedAt = item.published_at || item.created_at || item.timestamp
    ? new Date(String(item.published_at || item.created_at || item.timestamp))
    : new Date();

  return {
    source: String(item.platform || item.source || fallbackSource),
    externalId,
    url: typeof item.url === 'string' ? item.url : undefined,
    title: typeof item.title === 'string' ? item.title : undefined,
    content: String(item.content || item.text || item.caption || item.snippet || item.title || ''),
    author: typeof item.author === 'string' ? item.author : typeof item.author_name === 'string' ? item.author_name : undefined,
    authorHandle: typeof item.author_handle === 'string' ? item.author_handle : typeof item.username === 'string' ? item.username : undefined,
    community: typeof item.community === 'string' ? item.community : typeof item.subreddit === 'string' ? item.subreddit : undefined,
    publishedAt,
    language: typeof item.language === 'string' ? item.language : undefined,
    country: typeof item.country === 'string' ? item.country : undefined,
    engagement: item.engagement as RawMention['engagement'],
    reach: typeof item.reach === 'number' ? item.reach : undefined,
  };
}

export const dispatchMuapiTask = executeMuapiCapability;
