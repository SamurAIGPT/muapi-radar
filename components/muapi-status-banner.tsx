import { AlertTriangle, CheckCircle2, Clock, Radio, Server, ShieldCheck } from 'lucide-react';
import type { MuapiStatusInfo } from '@/lib/muapi-client';

interface Props {
  status: MuapiStatusInfo | null;
  isMuapiActive: boolean;
  itemCount?: number;
  className?: string;
}

export function MuapiStatusBanner({ status, isMuapiActive, itemCount = 0, className = '' }: Props) {
  if (!isMuapiActive) {
    return (
      <div className={`rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4 text-xs text-amber-300/90 ${className}`}>
        <div className="flex items-center gap-2 font-medium">
          <AlertTriangle className="size-4 text-amber-400 shrink-0" />
          <span>Muapi API key not configured. Add MUAPI_API_KEY to enable real-time intelligence.</span>
        </div>
      </div>
    );
  }

  const isFailed = status?.status === 'failed';
  const isQueued = status?.status === 'queued';
  const isEmpty = status?.status === 'empty' || (status?.status === 'ok' && itemCount === 0);

  // Determine badge & status styling
  let borderClass = 'border-emerald-500/30 bg-emerald-500/[0.03] text-emerald-300';
  let badgeClass = 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
  let statusText = 'Live Stream Connected';

  if (isFailed) {
    borderClass = 'border-rose-500/30 bg-rose-500/[0.04] text-rose-300';
    badgeClass = 'bg-rose-500/15 text-rose-400 border-rose-500/30';
    statusText = 'Upstream Muapi Service Alert';
  } else if (isQueued) {
    borderClass = 'border-sky-500/30 bg-sky-500/[0.04] text-sky-300';
    badgeClass = 'bg-sky-500/15 text-sky-400 border-sky-500/30';
    statusText = 'Worker Processing';
  } else if (isEmpty) {
    borderClass = 'border-amber-500/30 bg-amber-500/[0.04] text-amber-300';
    badgeClass = 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    statusText = '0 Live Mentions Found';
  }

  return (
    <div className={`mb-6 overflow-hidden rounded-xl border backdrop-blur-md transition-all ${borderClass} ${className}`}>
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-200">
              <Radio className="size-3.5 text-sky-400 animate-pulse" />
              Strict Muapi Mode
            </span>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${badgeClass}`}>
              {isFailed ? <AlertTriangle className="size-3" /> : isQueued ? <Clock className="size-3 animate-spin" /> : <ShieldCheck className="size-3" />}
              {statusText}
            </span>
            <span className="rounded-full bg-slate-800/80 px-2 py-0.5 text-[11px] text-slate-400 border border-slate-700/50">
              Fallback Data: Disabled
            </span>
          </div>

          <p className="text-xs text-slate-300">
            {isFailed ? (
              <span>
                <strong className="text-rose-300 font-semibold">Reason: </strong>
                <span className="text-rose-200/90 font-mono bg-rose-950/40 px-1.5 py-0.5 rounded border border-rose-800/40">
                  {status?.error || 'Unknown upstream error returned from Muapi service'}
                </span>
              </span>
            ) : isQueued ? (
              <span>Muapi asynchronous workers are currently executing query across social & news networks.</span>
            ) : isEmpty ? (
              <span>Muapi query completed successfully, but returned 0 matches for current keywords. Strict mode prevents fallback scraping.</span>
            ) : (
              <span>Directly streaming verified intelligence from Muapi API endpoints.</span>
            )}
          </p>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400 pt-1">
            {status?.endpoint && (
              <span className="flex items-center gap-1">
                <Server className="size-3 text-slate-500" />
                Endpoint: <code className="text-slate-300">{status.endpoint}</code>
              </span>
            )}
            {status?.requestId && (
              <span className="flex items-center gap-1">
                Request ID: <code className="text-sky-300 bg-sky-950/40 px-1 py-0.5 rounded border border-sky-800/30">{status.requestId}</code>
              </span>
            )}
            {status?.lastCalledAt && (
              <span className="flex items-center gap-1 text-slate-500">
                Checked: {new Date(status.lastCalledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 self-start sm:self-center">
          <span className="text-[11px] font-medium text-slate-400 bg-slate-900/60 px-2.5 py-1 rounded-lg border border-slate-800 flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${itemCount > 0 ? 'bg-emerald-400' : isFailed ? 'bg-rose-400' : 'bg-amber-400'}`} />
            {itemCount} Real Mentions
          </span>
        </div>
      </div>

      {isFailed && (
        <div className="border-t border-rose-500/20 bg-rose-950/30 px-4 py-2 text-[11px] text-rose-300/80 flex items-center justify-between">
          <span>
            Notice: Per configuration, all RSS fallback scrapers and synthetic datasets are completely deactivated. Only real data from Muapi will ever be shown.
          </span>
        </div>
      )}
    </div>
  );
}
