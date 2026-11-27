import { useId } from 'react';

interface PulsoLogoProps {
  /**
   * Background the logo sits on. `auto` follows the active theme tokens;
   * `dark` forces light text for always-dark surfaces (room sidebar).
   */
  variant?: 'auto' | 'light' | 'dark';
  size?: 'sm' | 'md';
}

export function PulsoLogo({ variant = 'auto', size = 'md' }: PulsoLogoProps) {
  const gradientId = useId();
  const iconSize = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8';
  const textSize = size === 'sm' ? 'text-lg' : 'text-xl';
  const textColor =
    variant === 'dark' ? 'text-white' : variant === 'light' ? 'text-[#0d0e1a]' : 'text-ink';

  return (
    <div className="inline-flex items-center gap-2.5 select-none">
      <svg
        viewBox="0 0 64 48"
        fill="none"
        className={iconSize}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="50%" x2="100%" y2="50%">
            <stop offset="0%" stopColor="#4F46E5" />
            <stop offset="100%" stopColor="#8B2FC9" />
          </linearGradient>
        </defs>
        <path
          d="M4 26H13L17 31L23 19L28 33L34 8L40 40L46 16L51 26H60"
          stroke={`url(#${gradientId})`}
          strokeWidth="4.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className={`font-bold tracking-[-0.03em] ${textSize} ${textColor}`}>
        PULSO
      </span>
    </div>
  );
}
