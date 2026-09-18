let cache: Record<string, string> = {};

export function setConnectorConfig(store: Record<string, string>) {
  cache = store;
}

export function cfg(env: string): string | undefined {
  const fromCache = cache[env];
  if (fromCache && fromCache.trim()) return fromCache;
  const fromEnv = typeof process !== 'undefined' ? process.env[env] : undefined;
  return fromEnv && fromEnv.trim() ? fromEnv : undefined;
}
