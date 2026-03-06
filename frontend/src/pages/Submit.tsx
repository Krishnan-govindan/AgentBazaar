import { useState, type FormEvent } from "react";
import { Send, Loader2, CheckCircle, AlertCircle, Sparkles } from "lucide-react";
import { Layout } from "../components/Layout";
import { BadgeChip } from "../components/BadgeChip";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const MAX_CAPABILITY = 500;

interface SponsoredAd {
  title?: string;
  description?: string;
  url?: string;
  offerUrl?: string;
}

interface Scorecard {
  agent_name: string;
  overall_score: number;
  badge: string;
  summary: string;
  risk_flags: string[];
  dimension_scores: Record<string, number>;
  sponsored_context?: SponsoredAd[];
}

type ToastState =
  | { type: "success"; scorecard: Scorecard }
  | { type: "error"; message: string }
  | null;

export default function Submit() {
  const [agentName, setAgentName] = useState("");
  const [capability, setCapability] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!agentName.trim() || !capability.trim() || !url.trim()) return;

    setLoading(true);
    setToast(null);

    try {
      const res = await fetch(`${API_URL}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_name: agentName.trim(),
          capability: capability.trim(),
          url: url.trim(),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }

      const scorecard: Scorecard = await res.json();
      setToast({ type: "success", scorecard });
      setAgentName("");
      setCapability("");
      setUrl("");
    } catch (err) {
      setToast({ type: "error", message: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  const DIMENSIONS = ["autonomy", "reasoning", "tool_use", "safety", "reliability"] as const;

  return (
    <Layout>
      <div className="max-w-2xl space-y-6">
        <div>
          <h2 className="text-xl font-bold text-white">Submit Agent</h2>
          <p className="text-sm text-slate-400 mt-1">
            Validate an AI agent's capabilities and receive a scored badge.
          </p>
        </div>

        {/* Result toast */}
        {toast?.type === "success" && (
          <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-5 animate-[slideIn_0.3s_ease-out]">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle className="h-5 w-5 text-green-400" />
              <span className="font-semibold text-green-300">Validation Complete</span>
              <BadgeChip badge={toast.scorecard.badge} className="ml-auto" />
            </div>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-4xl font-bold text-white">{toast.scorecard.overall_score}</span>
              <span className="text-slate-400">/100 overall score</span>
            </div>
            <p className="text-sm text-slate-300 mb-3">{toast.scorecard.summary}</p>

            {/* Dimension scores */}
            <div className="grid grid-cols-5 gap-2">
              {DIMENSIONS.map((dim) => (
                <div key={dim} className="text-center">
                  <div className="text-lg font-bold text-white">
                    {toast.scorecard.dimension_scores[dim]}
                  </div>
                  <div className="text-xs text-slate-500 capitalize">{dim.replace("_", " ")}</div>
                </div>
              ))}
            </div>

            {toast.scorecard.risk_flags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {toast.scorecard.risk_flags.map((f) => (
                  <span
                    key={f}
                    className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-400 border border-red-500/20"
                  >
                    {f}
                  </span>
                ))}
              </div>
            )}

            {/* ZeroClick Sponsored Context */}
            {toast.scorecard.sponsored_context && toast.scorecard.sponsored_context.length > 0 && (
              <div className="mt-4 border-t border-green-500/20 pt-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <Sparkles className="h-3 w-3 text-amber-400" />
                  <span className="text-xs text-amber-400 font-medium uppercase tracking-wide">
                    Sponsored — ZeroClick × Nevermined
                  </span>
                </div>
                <div className="space-y-2">
                  {toast.scorecard.sponsored_context.map((ad, i) => (
                    <a
                      key={i}
                      href={ad.offerUrl ?? ad.url ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded-lg border border-amber-500/10 bg-[#0f1117] p-2.5 hover:border-amber-500/30 transition-colors"
                    >
                      <div className="text-xs font-medium text-white">{ad.title ?? "Sponsored Offer"}</div>
                      {ad.description && (
                        <div className="text-xs text-slate-500 mt-0.5">{ad.description}</div>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {toast?.type === "error" && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 flex items-start gap-3 animate-[slideIn_0.3s_ease-out]">
            <AlertCircle className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-red-300">Validation failed</p>
              <p className="text-sm text-red-400 mt-0.5">{toast.message}</p>
              {toast.message.includes("402") && (
                <p className="text-xs text-slate-500 mt-1">
                  Payment required — purchase a Nevermined plan to call this endpoint.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="rounded-xl border border-[#2a2d3a] bg-[#1a1d27] p-6 space-y-5">
          {/* Agent Name */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Agent Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="e.g. ResearchBot Pro"
              required
              className="w-full rounded-lg border border-[#2a2d3a] bg-[#0f1117] px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/20"
            />
          </div>

          {/* Capability */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Capability Description <span className="text-red-400">*</span>
            </label>
            <textarea
              value={capability}
              onChange={(e) => setCapability(e.target.value.slice(0, MAX_CAPABILITY))}
              placeholder="Describe what this agent does — its tools, reasoning approach, and use case…"
              required
              rows={4}
              className="w-full rounded-lg border border-[#2a2d3a] bg-[#0f1117] px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/20 resize-none"
            />
            <p className="mt-1 text-xs text-slate-500 text-right">
              {capability.length}/{MAX_CAPABILITY}
            </p>
          </div>

          {/* URL */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Agent URL <span className="text-red-400">*</span>
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-agent.com"
              required
              className="w-full rounded-lg border border-[#2a2d3a] bg-[#0f1117] px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/20"
            />
            <p className="mt-1 text-xs text-slate-500">
              We'll scrape this URL to evaluate your agent's actual deployment.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading || !agentName.trim() || !capability.trim() || !url.trim()}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Validating… (8–12s)
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Validate Agent
              </>
            )}
          </button>
        </form>

        <p className="text-xs text-slate-600">
          Validation costs 1 credit via Nevermined x402 payment protocol.
          <br />
          The pipeline runs: Apify web scrape → Exa semantic search → Claude AI scoring.
        </p>
      </div>
    </Layout>
  );
}
