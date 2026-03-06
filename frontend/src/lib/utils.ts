import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export const BADGE_COLORS: Record<string, string> = {
  platinum: "bg-purple-500/20 text-purple-300 border border-purple-500/40",
  gold: "bg-yellow-500/20 text-yellow-300 border border-yellow-500/40",
  silver: "bg-slate-500/20 text-slate-300 border border-slate-500/40",
  bronze: "bg-orange-500/20 text-orange-300 border border-orange-500/40",
  needs_work: "bg-red-500/20 text-red-300 border border-red-500/40",
};

export const BADGE_LABELS: Record<string, string> = {
  platinum: "Platinum",
  gold: "Gold",
  silver: "Silver",
  bronze: "Bronze",
  needs_work: "Needs Work",
};
