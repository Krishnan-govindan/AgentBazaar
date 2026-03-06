import { cn, BADGE_COLORS, BADGE_LABELS } from "../lib/utils";

interface BadgeChipProps {
  badge: string;
  className?: string;
}

export function BadgeChip({ badge, className }: BadgeChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        BADGE_COLORS[badge] ?? "bg-gray-500/20 text-gray-300 border border-gray-500/40",
        className
      )}
    >
      {BADGE_LABELS[badge] ?? badge}
    </span>
  );
}
