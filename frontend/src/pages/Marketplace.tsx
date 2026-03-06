import { useState, useEffect } from "react";
import {
  ShoppingCart,
  ArrowRightLeft,
  Loader2,
  CheckCircle,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Layout } from "../components/Layout";
import { supabase, supabaseConfigured } from "../lib/supabase";
import { timeAgo } from "../lib/utils";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

interface Agent {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  pricing: string;
  endpoint: string;
  plan_did?: string;
  status: string;
}

interface Transaction {
  id: string;
  from_agent_id: string;
  to_agent_id: string;
  message_sent: string;
  response_status: number;
  response_body: string;
  created_at: string;
}

export default function Marketplace() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [txLoading, setTxLoading] = useState(true);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [buyResult, setBuyResult] = useState<{ id: string; success: boolean; msg: string } | null>(null);
  const [newTxIds, setNewTxIds] = useState<Set<string>>(new Set());

  // Fetch agents directory
  async function fetchAgents() {
    setAgentsLoading(true);
    try {
      const res = await fetch(`${API_URL}/agents`);
      if (res.ok) setAgents(await res.json());
    } catch {
      // silently fail
    } finally {
      setAgentsLoading(false);
    }
  }

  // Fetch transaction ledger
  async function fetchTransactions() {
    setTxLoading(true);
    try {
      const res = await fetch(`${API_URL}/marketplace/transactions?limit=50`);
      if (res.ok) setTransactions(await res.json());
    } catch {
      // silently fail
    } finally {
      setTxLoading(false);
    }
  }

  useEffect(() => {
    fetchAgents();
    fetchTransactions();
  }, []);

  // Supabase realtime on agent_purchases
  useEffect(() => {
    if (!supabaseConfigured || !supabase) return;
    const channel = supabase
      .channel("agent_purchases_feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "agent_purchases" },
        (payload) => {
          const newTx = payload.new as Transaction;
          setTransactions((prev) => [newTx, ...prev.slice(0, 49)]);
          setNewTxIds((prev) => new Set(prev).add(newTx.id));
          setTimeout(() => {
            setNewTxIds((prev) => {
              const next = new Set(prev);
              next.delete(newTx.id);
              return next;
            });
          }, 3000);
        }
      )
      .subscribe();
    return () => {
      supabase!.removeChannel(channel);
    };
  }, []);

  async function handleBuy(agent: Agent) {
    setBuyingId(agent.id);
    setBuyResult(null);
    const message = `research ${agent.description}`;
    try {
      const res = await fetch(
        `${API_URL}/marketplace/buy?agent_id=${encodeURIComponent(agent.id)}&message=${encodeURIComponent(message)}`,
        { method: "POST" }
      );
      if (res.ok) {
        setBuyResult({ id: agent.id, success: true, msg: "Purchase sent! Transaction logged." });
        fetchTransactions();
      } else {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        setBuyResult({ id: agent.id, success: false, msg: err.detail ?? "Purchase failed" });
      }
    } catch (err) {
      setBuyResult({ id: agent.id, success: false, msg: (err as Error).message });
    } finally {
      setBuyingId(null);
    }
  }

  function statusColor(status: number) {
    if (status >= 200 && status < 300) return "text-green-400";
    if (status === 402) return "text-yellow-400";
    return "text-red-400";
  }

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h2 className="text-xl font-bold text-white">Marketplace</h2>
          <p className="text-sm text-slate-400 mt-1">
            Buy services from registered agents. All transactions use Nevermined x402 payments.
          </p>
        </div>

        {/* Agent Directory */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-blue-400" />
              Agent Directory
            </h3>
            <button
              onClick={fetchAgents}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </button>
          </div>

          {agentsLoading ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm py-8">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading agents…
            </div>
          ) : agents.length === 0 ? (
            <div className="rounded-xl border border-[#2a2d3a] bg-[#1a1d27] p-8 text-center text-slate-500 text-sm">
              No agents registered yet. Run the Supabase SQL schema to seed the directory.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className="rounded-xl border border-[#2a2d3a] bg-[#1a1d27] p-4 flex flex-col gap-3"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-sm font-semibold text-white leading-tight">{agent.name}</h4>
                      <span
                        className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                          agent.status === "active"
                            ? "bg-green-500/10 text-green-400"
                            : "bg-red-500/10 text-red-400"
                        }`}
                      >
                        {agent.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1 line-clamp-2">{agent.description}</p>
                  </div>

                  {agent.capabilities && agent.capabilities.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {agent.capabilities.slice(0, 3).map((cap) => (
                        <span
                          key={cap}
                          className="rounded-full bg-blue-500/10 px-2 py-0.5 text-xs text-blue-400 border border-blue-500/20"
                        >
                          {cap}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-auto pt-2 border-t border-[#2a2d3a]">
                    <span className="text-xs text-slate-400 font-medium">{agent.pricing}</span>
                    <button
                      onClick={() => handleBuy(agent)}
                      disabled={buyingId === agent.id}
                      className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {buyingId === agent.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <ShoppingCart className="h-3 w-3" />
                      )}
                      Buy
                    </button>
                  </div>

                  {/* Buy result feedback */}
                  {buyResult?.id === agent.id && (
                    <div
                      className={`flex items-center gap-1.5 text-xs ${
                        buyResult.success ? "text-green-400" : "text-red-400"
                      }`}
                    >
                      {buyResult.success ? (
                        <CheckCircle className="h-3.5 w-3.5" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5" />
                      )}
                      {buyResult.msg}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Transaction Ledger */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-green-400" />
              Cross-Team Transaction Ledger
              {supabaseConfigured && (
                <span className="flex items-center gap-1 text-xs text-green-400 font-normal">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                  Live
                </span>
              )}
            </h3>
            <button
              onClick={fetchTransactions}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </button>
          </div>

          {txLoading ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm py-8">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading transactions…
            </div>
          ) : transactions.length === 0 ? (
            <div className="rounded-xl border border-[#2a2d3a] bg-[#1a1d27] p-8 text-center text-slate-500 text-sm">
              No transactions yet. The auto-buyer runs every 10 minutes.
              <br />
              Click "Buy" above to trigger a manual purchase.
            </div>
          ) : (
            <div className="rounded-xl border border-[#2a2d3a] bg-[#1a1d27] overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#2a2d3a]">
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">From</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">To</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide hidden md:table-cell">Message</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr
                      key={tx.id}
                      className={`border-b border-[#2a2d3a] last:border-0 transition-colors ${
                        newTxIds.has(tx.id) ? "bg-blue-500/5 border-l-2 border-l-blue-500" : "hover:bg-white/[0.02]"
                      }`}
                    >
                      <td className="px-4 py-3">
                        <span className="text-xs font-mono text-slate-300 truncate max-w-[120px] block">
                          {tx.from_agent_id ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-mono text-blue-400 truncate max-w-[120px] block">
                          {tx.to_agent_id ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="text-xs text-slate-400 truncate max-w-[200px] block">
                          {tx.message_sent ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-mono font-medium ${statusColor(tx.response_status)}`}>
                          {tx.response_status ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-slate-500">
                          {tx.created_at ? timeAgo(tx.created_at) : "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-3 text-xs text-slate-600">
            Transactions are logged automatically every 10 minutes by the auto-buyer background task.
            The ledger above is evidence for the "Most Interconnected Agents" prize.
          </p>
        </div>
      </div>
    </Layout>
  );
}
