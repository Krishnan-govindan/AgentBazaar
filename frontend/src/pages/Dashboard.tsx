import { useEffect, useState, useCallback } from "react";
import { Activity, BarChart3, Calendar, AlertTriangle, ArrowRightLeft, Sparkles } from "lucide-react";
import { Layout } from "../components/Layout";
import { StatCard } from "../components/StatCard";
import { AgentCard } from "../components/AgentCard";
import { supabase, supabaseConfigured, type ValidationResult } from "../lib/supabase";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

interface Stats {
  total: number;
  average_score: number;
  rated_today: number;
  cross_team_transactions?: number;
}

interface SponsoredAd {
  title?: string;
  description?: string;
  url?: string;
  offerUrl?: string;
}

export default function Dashboard() {
  const [results, setResults] = useState<ValidationResult[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, average_score: 0, rated_today: 0 });
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [isLive, setIsLive] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [latestAds, _setLatestAds] = useState<SponsoredAd[]>([]);

  const fetchFeed = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/feed?limit=20`);
      if (res.ok) {
        setResults(await res.json());
        setBackendError(null);
      } else {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        setBackendError(err.detail);
      }
    } catch {
      setBackendError("Backend unreachable — is it running on port 8000?");
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      // Use marketplace/stats to get cross_team_transactions count
      const res = await fetch(`${API_URL}/marketplace/stats`);
      if (res.ok) setStats(await res.json());
    } catch {
      try {
        const res = await fetch(`${API_URL}/stats`);
        if (res.ok) setStats(await res.json());
      } catch {
        // silently skip
      }
    }
  }, []);

  useEffect(() => {
    fetchFeed();
    fetchStats();

    if (!supabaseConfigured || !supabase) return;

    const channel = supabase
      .channel("validation-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "validation_results" },
        (payload) => {
          const newRow = payload.new as ValidationResult;
          setResults((prev) => [newRow, ...prev.slice(0, 49)]);
          setNewIds((prev) => new Set(prev).add(newRow.id));
          setStats((prev) => ({
            total: prev.total + 1,
            average_score: Math.round(
              (prev.average_score * prev.total + newRow.overall_score) / (prev.total + 1)
            ),
            rated_today: prev.rated_today + 1,
          }));
          setTimeout(() => {
            setNewIds((prev) => {
              const next = new Set(prev);
              next.delete(newRow.id);
              return next;
            });
          }, 3000);
        }
      )
      .subscribe((status) => {
        setIsLive(status === "SUBSCRIBED");
      });

    return () => {
      supabase!.removeChannel(channel);
    };
  }, [fetchFeed, fetchStats]);

  return (
    <Layout isLive={isLive}>
      <div className="space-y-6 max-w-4xl">
        <div>
          <h2 className="text-xl font-bold text-white">Dashboard</h2>
          <p className="text-sm text-slate-400 mt-1">Real-time agent validation feed</p>
        </div>

        {/* Config warnings */}
        {!supabaseConfigured && (
          <div className="flex items-start gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Live feed disabled — add <code className="text-yellow-200">VITE_SUPABASE_URL</code> and{" "}
              <code className="text-yellow-200">VITE_SUPABASE_ANON_KEY</code> to{" "}
              <code className="text-yellow-200">frontend/.env</code> to enable realtime.
            </span>
          </div>
        )}
        {backendError && (
          <div className="flex items-start gap-3 rounded-lg border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm text-orange-300">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{backendError}</span>
          </div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Validations" value={stats.total} Icon={Activity} iconColor="text-blue-400" />
          <StatCard label="Average Score" value={stats.average_score || "—"} Icon={BarChart3} iconColor="text-green-400" />
          <StatCard label="Rated Today" value={stats.rated_today} Icon={Calendar} iconColor="text-purple-400" />
          <StatCard
            label="Cross-Team Txns"
            value={stats.cross_team_transactions ?? 0}
            Icon={ArrowRightLeft}
            iconColor="text-amber-400"
          />
        </div>

        {/* ZeroClick Sponsored Context — shows when latest validations have ads */}
        {latestAds.length > 0 && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-xs text-amber-400 font-medium uppercase tracking-wide">
                Sponsored — ZeroClick × Nevermined
              </span>
            </div>
            <div className="flex gap-3 flex-wrap">
              {latestAds.map((ad, i) => (
                <a
                  key={i}
                  href={ad.offerUrl ?? ad.url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 min-w-[200px] rounded-lg border border-amber-500/10 bg-[#1a1d27] p-3 hover:border-amber-500/30 transition-colors"
                >
                  <div className="text-sm font-medium text-white">{ad.title ?? "Sponsored Offer"}</div>
                  {ad.description && (
                    <div className="text-xs text-slate-400 mt-0.5">{ad.description}</div>
                  )}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Live feed */}
        <div>
          <h3 className="text-sm font-medium text-slate-300 mb-3">Recent Validations</h3>
          {results.length === 0 ? (
            <div className="rounded-xl border border-[#2a2d3a] bg-[#1a1d27] p-10 text-center">
              <p className="text-slate-500 text-sm">
                No validations yet.{" "}
                <a href="/submit" className="text-blue-400 hover:underline">
                  Submit an agent
                </a>{" "}
                to get started.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {results.map((r) => (
                <AgentCard key={r.id} result={r} isNew={newIds.has(r.id)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
