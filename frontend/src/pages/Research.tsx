import { useState, type FormEvent } from "react";
import { Search, Loader2, CheckCircle, AlertCircle, ExternalLink, Sparkles } from "lucide-react";
import { Layout } from "../components/Layout";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

interface ResearchResult {
  topic: string;
  executive_summary: string;
  key_findings: string[];
  market_data: {
    estimated_size?: string;
    growth_rate?: string;
    key_trends?: string[];
  };
  sources: { title: string; url: string }[];
  sponsored_context: { title?: string; description?: string; url?: string; offerUrl?: string }[];
}

export default function Research() {
  const [topic, setTopic] = useState("");
  const [depth, setDepth] = useState<"brief" | "detailed">("brief");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!topic.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`${API_URL}/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim(), depth }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }

      const data: ResearchResult = await res.json();
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Layout>
      <div className="max-w-3xl space-y-6">
        <div>
          <h2 className="text-xl font-bold text-white">Market Research</h2>
          <p className="text-sm text-slate-400 mt-1">
            AI-powered research brief using Exa deep search + Claude synthesis.
          </p>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-[#2a2d3a] bg-[#1a1d27] p-6 space-y-5"
        >
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Research Topic <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. AI agent marketplace economics"
              required
              className="w-full rounded-lg border border-[#2a2d3a] bg-[#0f1117] px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/20"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Depth</label>
            <select
              value={depth}
              onChange={(e) => setDepth(e.target.value as "brief" | "detailed")}
              className="w-full rounded-lg border border-[#2a2d3a] bg-[#0f1117] px-4 py-2.5 text-sm text-white focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/20"
            >
              <option value="brief">Brief (concise 1-page summary)</option>
              <option value="detailed">Detailed (in-depth 5-page report)</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={loading || !topic.trim()}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Researching… (15–25s)
              </>
            ) : (
              <>
                <Search className="h-4 w-4" />
                Generate Research Report ($0.50)
              </>
            )}
          </button>
        </form>

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 flex items-start gap-3 animate-[slideIn_0.3s_ease-out]">
            <AlertCircle className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-red-300">Research failed</p>
              <p className="text-sm text-red-400 mt-0.5">{error}</p>
              {error.includes("402") && (
                <p className="text-xs text-slate-500 mt-1">
                  Payment required — purchase a Nevermined plan to call this endpoint.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-4 animate-[slideIn_0.3s_ease-out]">
            {/* Executive Summary */}
            <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-5">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle className="h-5 w-5 text-blue-400" />
                <span className="font-semibold text-blue-300">Research Report</span>
                <span className="ml-auto text-xs text-slate-500 capitalize">{depth}</span>
              </div>
              <h3 className="text-lg font-bold text-white mb-2">{result.topic}</h3>
              <p className="text-sm text-slate-300 leading-relaxed">{result.executive_summary}</p>
            </div>

            {/* Key Findings */}
            {result.key_findings.length > 0 && (
              <div className="rounded-xl border border-[#2a2d3a] bg-[#1a1d27] p-5">
                <h4 className="text-sm font-semibold text-slate-200 mb-3">Key Findings</h4>
                <ol className="space-y-2">
                  {result.key_findings.map((f, i) => (
                    <li key={i} className="flex gap-3 text-sm text-slate-300">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-600/20 text-blue-400 text-xs flex items-center justify-center font-medium">
                        {i + 1}
                      </span>
                      {f}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Market Data */}
            {Object.keys(result.market_data).length > 0 && (
              <div className="rounded-xl border border-[#2a2d3a] bg-[#1a1d27] p-5">
                <h4 className="text-sm font-semibold text-slate-200 mb-3">Market Data</h4>
                <div className="grid grid-cols-2 gap-4">
                  {result.market_data.estimated_size && (
                    <div>
                      <div className="text-xs text-slate-500 uppercase tracking-wide">Market Size</div>
                      <div className="text-white font-medium mt-0.5">{result.market_data.estimated_size}</div>
                    </div>
                  )}
                  {result.market_data.growth_rate && (
                    <div>
                      <div className="text-xs text-slate-500 uppercase tracking-wide">Growth Rate</div>
                      <div className="text-white font-medium mt-0.5">{result.market_data.growth_rate}</div>
                    </div>
                  )}
                </div>
                {result.market_data.key_trends && result.market_data.key_trends.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">Key Trends</div>
                    <div className="flex flex-wrap gap-2">
                      {result.market_data.key_trends.map((t, i) => (
                        <span
                          key={i}
                          className="rounded-full bg-purple-500/10 px-3 py-0.5 text-xs text-purple-300 border border-purple-500/20"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Sources */}
            {result.sources.length > 0 && (
              <div className="rounded-xl border border-[#2a2d3a] bg-[#1a1d27] p-5">
                <h4 className="text-sm font-semibold text-slate-200 mb-3">Sources ({result.sources.length})</h4>
                <ul className="space-y-2">
                  {result.sources.map((s, i) => (
                    <li key={i}>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        <span className="truncate">{s.title || s.url}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ZeroClick Sponsored Context */}
            {result.sponsored_context && result.sponsored_context.length > 0 && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-xs text-amber-400 font-medium uppercase tracking-wide">
                    Sponsored — Powered by ZeroClick × Nevermined
                  </span>
                </div>
                <div className="space-y-2">
                  {result.sponsored_context.map((ad, i) => (
                    <a
                      key={i}
                      href={ad.offerUrl ?? ad.url ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded-lg border border-amber-500/10 bg-[#1a1d27] p-3 hover:border-amber-500/30 transition-colors"
                    >
                      <div className="text-sm font-medium text-white">
                        {ad.title ?? "Sponsored Offer"}
                      </div>
                      {ad.description && (
                        <div className="text-xs text-slate-400 mt-0.5">{ad.description}</div>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <p className="text-xs text-slate-600">
          Research costs 1 credit via Nevermined x402 payment protocol.
          <br />
          Pipeline: Exa 3-query search → Claude synthesis → ZeroClick sponsored context.
        </p>
      </div>
    </Layout>
  );
}
