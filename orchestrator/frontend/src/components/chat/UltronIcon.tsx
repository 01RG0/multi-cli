import React from 'react';

export interface UltronIconProps {
  size?: 'sm' | 'md' | 'lg' | 'hero';
  className?: string;
  pulse?: boolean;
  status?: 'online' | 'busy' | 'offline';
}

const sizeConfig = {
  sm: {
    container: 'w-7 h-7 rounded-lg text-sm',
    badge: 'w-2.5 h-2.5 -bottom-0.5 -right-0.5 border',
    dot: 'w-1 h-1',
  },
  md: {
    container: 'w-10 h-10 rounded-xl text-lg',
    badge: 'w-3 h-3 -bottom-0.5 -right-0.5 border-[1.5px]',
    dot: 'w-1 h-1',
  },
  lg: {
    container: 'w-12 h-12 rounded-xl text-xl',
    badge: 'w-3.5 h-3.5 -bottom-0.5 -right-0.5 border-2',
    dot: 'w-1.5 h-1.5',
  },
  hero: {
    container: 'w-16 h-16 rounded-2xl text-2xl',
    badge: 'w-4 h-4 -bottom-1 -right-1 border-2',
    dot: 'w-1.5 h-1.5',
  },
};

const statusColors = {
  online: 'bg-emerald-500',
  busy: 'bg-amber-500 animate-pulse',
  offline: 'bg-zinc-500',
};

export const UltronIcon: React.FC<UltronIconProps> = ({
  size = 'md',
  className = '',
  pulse = false,
  status = 'online',
}) => {
  const config = sizeConfig[size] || sizeConfig.md;
  const statusColor = statusColors[status] || statusColors.online;

  return (
    <div
      className={`relative ${config.container} bg-black border border-zinc-700/80 flex items-center justify-center font-bold text-white shadow-2xl shrink-0 transition-transform ${
        pulse ? 'ring-2 ring-emerald-500/50 shadow-emerald-500/20 animate-pulse scale-105' : ''
      } ${className}`}
    >
      <span className="bg-gradient-to-br from-white via-zinc-200 to-zinc-500 bg-clip-text text-transparent select-none">
        Ω
      </span>
      {status && (
        <span
          className={`absolute ${config.badge} rounded-full ${statusColor} border-black flex items-center justify-center`}
        >
          <span className={`rounded-full bg-white ${config.dot}`} />
        </span>
      )}
    </div>
  );
};
