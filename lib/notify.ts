// Push notifications via Telegram bot (clean, non-intrusive)
export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

export async function sendTelegram(text: string): Promise<boolean> {
  if (!telegramConfigured()) return false;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text: text.slice(0, 4000),
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          disable_notification: true,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function sendWithSound(text: string): Promise<boolean> {
  if (!telegramConfigured()) return false;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text: text.slice(0, 4000),
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

const appUrl = () => process.env.APP_URL ?? '';

/** One message for freshly generated alerts. Sound only if severity is high. */
export async function notifyAlerts(projectName: string, items: { message: string; severity: string }[]) {
  if (items.length === 0) return;
  const lines = items.map((a) => `${a.severity === 'high' || a.severity === 'alta' ? '🔴' : '🟠'} ${a.message}`).join('\n');
  const text = `<b>⚠️ ${projectName}</b>\n${lines}${appUrl() ? `\n\n<a href="${appUrl()}/alerts">View alerts →</a>` : ''}`;
  const loud = items.some((a) => a.severity === 'high' || a.severity === 'alta');
  await (loud ? sendWithSound(text) : sendTelegram(text));
}

/** Silent morning digest: one row of stats + link to brief. */
export async function notifyDailyDigest(projectName: string, stats: {
  mentions24h: number; sentiment: string; topTrend?: string;
}) {
  const trend = stats.topTrend ? ` · trend: <i>${stats.topTrend}</i>` : '';
  await sendTelegram(
    `☀️ <b>${projectName}</b> — today's executive brief is ready\n${stats.mentions24h} mentions in the last 24h · sentiment ${stats.sentiment}${trend}${appUrl() ? `\n<a href="${appUrl()}/brief">Read the brief →</a>` : ''}`,
  );
}
