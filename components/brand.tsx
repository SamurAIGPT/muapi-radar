export const APP_NAME = process.env.NEXT_PUBLIC_BRAND_NAME || 'Muapi Radar';
export const APP_BYLINE = process.env.NEXT_PUBLIC_BRAND_BYLINE || 'Media Intelligence';

export function BrandMark({ className = 'size-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={`${className} shrink-0`} fill="none" aria-hidden="true">
      {/* Concentric radar rings */}
      <circle cx="32" cy="32" r="26" stroke="currentColor" strokeWidth="2.4" className="opacity-25" />
      <path d="M37.61 5.59 A27 27 0 1 0 57.03 21.89" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
      <circle cx="32" cy="32" r="16" stroke="currentColor" strokeWidth="1.8" className="opacity-30" />
      <path d="M34.78 16.24 A16 16 0 1 0 47.04 26.53" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="32" cy="32" r="8" stroke="currentColor" strokeWidth="1.4" className="opacity-35" />

      {/* Radar sweep beam and locked signal blip */}
      <path d="M32 32 L52.1 11.9" className="stroke-cyan-400" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="52.1" cy="11.9" r="3.4" className="fill-cyan-400" />

      {/* Center node */}
      <circle cx="32" cy="32" r="3.2" fill="currentColor" />
    </svg>
  );
}

export function BrandWordmark({ className = 'h-3.5' }: { className?: string }) {
  return (
    <span className={`font-semibold tracking-tight text-white flex items-center gap-1 ${className}`}>
      <span>Muapi</span>
      <span className="text-cyan-400">Radar</span>
    </span>
  );
}

export function Brand({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const iconSize = size === 'lg' ? 'size-6' : size === 'sm' ? 'size-4' : 'size-5';
  const textSize = size === 'lg' ? 'text-lg' : size === 'sm' ? 'text-xs' : 'text-sm';

  const isMuapi = APP_NAME.toLowerCase().includes('muapi');

  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-100 shadow-sm">
        <BrandMark className={iconSize} />
      </div>
      <div className="flex min-w-0 flex-col leading-tight">
        <div className="flex items-center gap-1.5">
          {isMuapi ? (
            <span className={`${textSize} font-semibold tracking-tight text-white`}>
              Muapi<span className="text-cyan-400 ml-0.5">Radar</span>
            </span>
          ) : (
            <span className={`${textSize} font-semibold tracking-tight text-white truncate`}>
              {APP_NAME}
            </span>
          )}
          <span className="rounded border border-cyan-500/25 bg-cyan-500/10 px-1 py-0.2 text-[9px] font-medium tracking-wide text-cyan-300">
            PRO
          </span>
        </div>
        <span className="truncate text-[10px] font-medium tracking-wide text-slate-400">
          Media Intelligence
        </span>
      </div>
    </div>
  );
}

