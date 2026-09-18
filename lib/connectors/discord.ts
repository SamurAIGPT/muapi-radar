import { collect, fetchJson, truncate } from './util';
import type { Connector, RawMention } from './types';
import { cfg } from '@/lib/connector-config';

type DcAuthor = { id: string; username: string; global_name?: string | null; bot?: boolean };
type DcReaction = { count: number };
type DcMessage = {
  id: string; content: string; timestamp: string; author: DcAuthor;
  reactions?: DcReaction[];
};
type DcChannel = { id: string; guild_id?: string; name?: string };

async function fetchChannel(channelId: string, token: string): Promise<RawMention[]> {
  try {
    const headers = { authorization: `Bot ${token}` };
    const [channel, messages] = await Promise.all([
      fetchJson<DcChannel>(`https://discord.com/api/v10/channels/${channelId}`, { headers }),
      fetchJson<DcMessage[]>(`https://discord.com/api/v10/channels/${channelId}/messages?limit=100`, { headers }),
    ]);
    return messages
      .filter((m) => !m.author?.bot && m.content?.trim())
      .map((m) => {
        const likes = (m.reactions ?? []).reduce((s, r) => s + r.count, 0);
        return {
          source: 'discord',
          externalId: m.id,
          url: channel.guild_id ? `https://discord.com/channels/${channel.guild_id}/${channelId}/${m.id}` : undefined,
          content: truncate(m.content, 1500),
          author: m.author.global_name || m.author.username,
          community: channel.name ? `#${channel.name}` : channelId,
          publishedAt: new Date(m.timestamp),
          engagement: { likes },
        } satisfies RawMention;
      });
  } catch {
    return [];
  }
}

export const discord: Connector = {
  id: 'discord',
  label: 'Discord',
  tier: 'freekey',
  enabled: () => Boolean(cfg('DISCORD_BOT_TOKEN') && cfg('DISCORD_CHANNEL_IDS')),
  disabledReason: 'Requires Discord Bot Token and Channel IDs in Settings',
  async fetchMentions() {
    const token = cfg('DISCORD_BOT_TOKEN');
    const ids = (cfg('DISCORD_CHANNEL_IDS') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10);
    if (!token || ids.length === 0) return [];
    return collect(ids.map((id) => fetchChannel(id, token)));
  },
};
