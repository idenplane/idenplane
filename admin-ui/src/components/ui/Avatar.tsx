import { cn } from './cn';

export interface AvatarProps {
  name: string;
  /** Diameter in pixels. */
  size?: number;
  /** Render a ring around the avatar. */
  ring?: boolean;
  className?: string;
}

// Fixed gradient palette (static class strings so Tailwind can detect them).
const palettes = [
  'from-indigo-600 to-violet-600',
  'from-cyan-600 to-cyan-500',
  'from-green-600 to-emerald-500',
  'from-amber-600 to-amber-500',
  'from-violet-600 to-purple-500',
  'from-cyan-700 to-cyan-600',
  'from-pink-700 to-pink-500',
  'from-slate-600 to-slate-500',
];

function initialsOf(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function Avatar({ name, size = 32, ring, className }: AvatarProps) {
  const idx = (name.charCodeAt(0) + (name.charCodeAt(1) || 0)) % palettes.length;
  return (
    <div
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-semibold tracking-[-0.01em] text-white',
        palettes[idx],
        ring && 'ring-2 ring-offset-2 ring-offset-surface ring-current',
        className,
      )}
      // Dynamic pixel dimensions (data, not styling) — size is caller-driven.
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initialsOf(name)}
    </div>
  );
}
