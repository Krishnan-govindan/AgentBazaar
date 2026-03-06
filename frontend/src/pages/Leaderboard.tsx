import { useEffect, useState, useMemo } from "react";
import { Trophy, Search, ArrowUpDown } from "lucide-react";
import { Layout } from "../components/Layout";
import { BadgeChip } from "../components/BadgeChip";
import { timeAgo } from "../lib/utils";
import type { ValidationResult } from "../lib/supabase";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

type SortKey = "overall_score" | "created_at";

const RANK_COLORS: Record<number, string> = {
  1: "text-yellow-400",
  2: "text-slate-300",
  3: "text-orange-400",
};

export default function Leaderboard() {
  const [results, setResults] = useState<ValidationResult[]>([]);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("overall_score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/leaderboard?limit=100`);
        if (res.ok) setResults(await res.json());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    let rows = results.filter((r) =>
      r.agent_name.toLowerCase().includes(search.toLowerCase())
    );
    rows = [...rows].sort((a, b) => {
      const av = sortKey === "overall_score" ? a.overall_score : new Date(a.created_at).getTime();
      const bv = sortKey === "overall_score" ? b.overall_score : new Date(b.created_at).getTime();
      return sortDir === "desc" ? (bv as number) - (av as number) : (av as number) - (bv as number);
    });
    return rows;
  }, [results, search, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <Layout>
      <div className="space-y-5 max-w-5xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Trophy className="h-5 w-5 text-yellow-400" />
              Leaderboard
            </h2>
            <p className="text-sm text-slate-400 mt-1">Top-scoring AI agents</p>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agents…"
              className="rounded-lg border border-[#2a2d3a] bg-[#1a1d27] pl-9 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500/50 focus:outline-none w-56"
            />
          </div>
        </div>

        {loading ? (
          <div className="text-slate-500 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-[#2a2d3a] bg-[#1a1d27] p-10 text-center">
            <p className="text-slate-500 text-sm">No results found.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-[#2a2d3a] bg-[#1a1d27] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#2a2d3a] text-slate-400">
                  <th className="px-4 py-3 text-left font-medium w-12">#</th>
                  <th className="px-4 py-3 text-left font-medium">Agent</th>
                  <th className="px-4 py-3 text-left font-medium">Badge</th>
                  <th
                    className="px-4 py-3 text-left font-medium cursor-pointer select-none hover:text-white"
                    onClick={() => toggleSort("overall_score")}
                  >
                    <span className="inline-flex items-center gap-1">
                      Score
                      <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className="px-4 py-3 text-left font-medium">Risk Flags</th>
                  <th
                    className="px-4 py-3 text-left font-medium cursor-pointer select-none hover:text-white"
                    onClick={() => toggleSort("created_at")}
                  >
                    <span className="inline-flex items-center gap-1">
                      Validated
                      <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr
                    key={r.id}
                    className="border-b border-[#2a2d3a] last:border-0 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className={`px-4 py-3 font-bold ${RANK_COLORS[i + 1] ?? "text-slate-500"}`}>
                      {i + 1}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{r.agent_name}</div>
                      <div className="text-xs text-slate-500 truncate max-w-xs">{r.capability}</div>
                    </td>
                    <td className="px-4 py-3">
                      <BadgeChip badge={r.badge} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-bold text-white">{r.overall_score}</span>
                      <span className="text-slate-500">/100</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {r.risk_flags.length === 0 ? (
                          <span className="text-slate-600">—</span>
                        ) : (
                          r.risk_flags.map((f) => (
                            <span
                              key={f}
                              className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-400 border border-red-500/20"
                            >
                              {f}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{timeAgo(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
