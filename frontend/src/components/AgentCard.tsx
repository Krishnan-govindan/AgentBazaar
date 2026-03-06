import { BadgeChip } from "./BadgeChip";
import { timeAgo } from "../lib/utils";
import type { ValidationResult } from "../lib/supabase";

interface AgentCardProps {
  result: ValidationResult;
  isNew?: boolean;
}

export function AgentCard({ result, isNew }: AgentCardProps) {
  return (
    <div
      className={`rounded-xl border border-[#2a2d3a] bg-[#1a1d27] p-4 transition-all ${
        isNew ? "animate-[slideIn_0.3s_ease-out] border-blue-500/30" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-white truncate">{result.agent_name}</span>
            <BadgeChip badge={result.badge} />
          </div>
          <p className="mt-1 text-sm text-slate-400 line-clamp-2">{result.capability}</p>
          {result.risk_flags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {result.risk_flags.map((flag) => (
                <span
                  key={flag}
                  className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-400 border border-red-500/20"
                >
                  {flag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-2xl font-bold text-white">{result.overall_score}</span>
          <span className="text-xs text-slate-500">{timeAgo(result.created_at)}</span>
        </div>
      </div>
    </div>
  );
}
