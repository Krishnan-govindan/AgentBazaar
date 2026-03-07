import { useState, useEffect, useCallback } from "react";
import {
  ShoppingCart, ArrowRightLeft, Loader2, CheckCircle, AlertCircle,
  RefreshCw, Zap, Search, Star, Heart, Send, X,
  TrendingUp, Users, Globe, BarChart3, Cpu, Database, Shield,
  DollarSign, Briefcase, ChevronDown, ChevronUp,
  MessageSquare, Plus, CheckCheck, Clock, Award, Download,
  Trophy, Activity
} from "lucide-react";
import { Layout } from "../components/Layout";
import { supabase, supabaseConfigured } from "../lib/supabase";
import { timeAgo } from "../lib/utils";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Agent {
  id: string; name: string; team_name?: string; category?: string;
  description: string; capabilities: string[]; pricing: string;
  endpoint: string; plan_did?: string; status: string; source?: string;
  validation_score?: number | null; badge_tier?: string | null;
  validated_at?: string | null; zeroclick_context?: string | null;
  // ABTS Trust Score fields
  abts_score?: number | null; abts_tier?: string | null;
  abts_components?: { R: number; P: number; V: number; S: number; c_conf: number } | null;
  interaction_count?: number; rating_sum?: number; rating_count?: number;
}
interface Transaction {
  id: string; from_agent_id: string; to_agent_id: string;
  message_sent: string; response_status: number; response_body: string; created_at: string;
}
interface Proposal {
  id: string; from_agent: string; to_agent_name: string;
  to_team_name: string; message: string; response_status: number; created_at: string;
}
interface JobProposal {
  id: string; poster_agent_id: string; title: string; description: string;
  budget_credits: number; deadline_days: number;
  status: "open" | "funded" | "delivered" | "closed";
  winning_bid_id?: string | null; transaction_id?: string | null;
  created_at: string; bid_count?: number;
}
interface JobBid {
  id: string; proposal_id: string; bidder_agent_id: string; approach: string;
  timeline_days: number; price_credits: number; contact_endpoint: string;
  claude_score?: number; claude_reasoning?: string;
  status: "pending" | "accepted" | "rejected"; created_at: string;
}
interface AgentMessage {
  id: string; proposal_id: string; from_agent_id: string;
  to_agent_id: string; content: string; delivered: boolean; created_at: string;
}
interface ZeroClickAd { title?: string; body?: string; url?: string; cta?: string }
interface MatchResult { matches: Agent[]; sponsored_context: ZeroClickAd[]; }
interface FutureProposal {
  id: string; title: string; description: string;
  deliverables: string[]; timeline_days: number; price_credits: number;
  status: "proposed"|"negotiating"|"accepted"|"building"|"delivered"|"rejected";
  proposer_agent_id: string; target_agent_id: string; target_endpoint: string;
  counter_price?: number; counter_timeline?: number; negotiation_notes?: string;
  zeroclick_context: Array<{ title?: string; description?: string; url?: string; offerUrl?: string }>;
  created_at: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const CATEGORIES = [
  "All","AI/ML","Research","Data Analytics","Infrastructure",
  "DeFi","Social","API Services","Dynamic Pricing","Memory",
  "Banking","Services","Validation","Agent Review Board"
];
const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  "All":<Globe className="h-3 w-3"/>,"AI/ML":<Cpu className="h-3 w-3"/>,
  "Research":<Search className="h-3 w-3"/>,"Data Analytics":<BarChart3 className="h-3 w-3"/>,
  "Infrastructure":<Database className="h-3 w-3"/>,"DeFi":<DollarSign className="h-3 w-3"/>,
  "Social":<Users className="h-3 w-3"/>,"API Services":<Globe className="h-3 w-3"/>,
  "Banking":<DollarSign className="h-3 w-3"/>,"Validation":<Shield className="h-3 w-3"/>,
  "Memory":<Database className="h-3 w-3"/>,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function scoreColor(score?: number | null) {
  if (!score) return "text-slate-500";
  if (score >= 90) return "text-purple-400";
  if (score >= 75) return "text-yellow-400";
  if (score >= 50) return "text-blue-400";
  if (score >= 25) return "text-orange-400";
  return "text-red-400";
}
function abtsTierStyle(tier?: string | null) {
  switch (tier) {
    case "Elite":    return { bg: "bg-purple-500/20 border-purple-500/40 text-purple-300", icon: "🏆", glow: "shadow-purple-500/20" };
    case "Trusted":  return { bg: "bg-yellow-500/20 border-yellow-500/40 text-yellow-300", icon: "⭐", glow: "shadow-yellow-500/20" };
    case "Verified": return { bg: "bg-blue-500/20 border-blue-500/40 text-blue-300",        icon: "✓",  glow: "shadow-blue-500/20"   };
    default:         return { bg: "bg-slate-700/50 border-slate-600/30 text-slate-400",      icon: "◦",  glow: ""                     };
  }
}
function abtsScoreColor(score?: number | null) {
  if (score == null || score === 0) return "text-slate-500";
  if (score >= 80) return "text-purple-400";
  if (score >= 60) return "text-yellow-400";
  if (score >= 35) return "text-blue-400";
  return "text-slate-500";
}
function statusColor(status: number) {
  if (status >= 200 && status < 300) return "text-green-400";
  if (status === 402) return "text-yellow-400";
  return "text-red-400";
}
function bidStatusStyle(s: string) {
  if (s === "accepted") return "bg-green-500/20 text-green-300 border border-green-500/30";
  if (s === "rejected") return "bg-red-500/10 text-red-400 border border-red-500/20";
  return "bg-blue-500/10 text-blue-400 border border-blue-500/20";
}
function proposalStatusStyle(s: string) {
  if (s === "funded")    return "bg-green-500/20 text-green-300 border border-green-500/30";
  if (s === "delivered") return "bg-purple-500/20 text-purple-300 border border-purple-500/30";
  if (s === "closed")    return "bg-slate-500/20 text-slate-400 border border-slate-500/30";
  return "bg-blue-500/10 text-blue-400 border border-blue-500/20";
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function Marketplace() {
  const [agents, setAgents]             = useState<Agent[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [proposals, setProposals]       = useState<Proposal[]>([]);
  const [jobProposals, setJobProposals] = useState<JobProposal[]>([]);
  const [loading, setLoading]           = useState(true);
  const [txLoading, setTxLoading]       = useState(true);
  const [category, setCategory]         = useState("All");
  const [search, setSearch]             = useState("");
  const [actingId, setActingId]         = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{ id: string; type: string; success: boolean; msg: string } | null>(null);
  const [matchModal, setMatchModal]     = useState<{ agent: Agent; data: MatchResult } | null>(null);
  const [validating, setValidating]     = useState(false);
  const [syncing, setSyncing]           = useState(false);
  const [syncResult, setSyncResult]     = useState<string | null>(null);
  const [newTxIds, setNewTxIds]         = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab]       = useState<"directory"|"transactions"|"proposals"|"jobboard"|"abts"|"future">("directory");
  const [abtsTierFilter, setAbtsTierFilter] = useState<"All"|"Elite"|"Trusted"|"Verified"|"New">("All");

  // Job Board state
  const [expandedProposal, setExpandedProposal] = useState<string | null>(null);
  const [proposalBids, setProposalBids]         = useState<Record<string, JobBid[]>>({});
  const [proposalMsgs, setProposalMsgs]         = useState<Record<string, AgentMessage[]>>({});
  const [showPostModal, setShowPostModal]       = useState(false);
  const [bidModal, setBidModal]                 = useState<JobProposal | null>(null);
  const [msgModal, setMsgModal]                 = useState<JobProposal | null>(null);
  const [jobLoading, setJobLoading]             = useState(false);
  const [jobStatusFilter, setJobStatusFilter]   = useState<"open"|"funded"|"all">("open");
  const [abtsLeaderboard, setAbtsLeaderboard]   = useState<Agent[]>([]);
  const [abtsLoading, setAbtsLoading]           = useState(false);
  const [abtsTierTab, setAbtsTierTab]           = useState<string>("All");

  // Future Proposals state
  const [futureProposals, setFutureProposals]   = useState<FutureProposal[]>([]);
  const [futureFilter, setFutureFilter]         = useState<"all"|"proposed"|"negotiating"|"accepted">("all");
  const [futureLoading, setFutureLoading]       = useState(false);
  const [outreachResult, setOutreachResult]     = useState<string | null>(null);
  const [outreachLoading, setOutreachLoading]   = useState(false);
  const [showFutureModal, setShowFutureModal]   = useState(false);
  const [futureNegotiateId, setFutureNegotiateId] = useState<string | null>(null);
  const [futureCounterPrice, setFutureCounterPrice] = useState("");
  const [futureCounterTimeline, setFutureCounterTimeline] = useState("");
  const [futureCounterMsg, setFutureCounterMsg] = useState("");

  // ── Fetch fns ─────────────────────────────────────────────────────────────
  const fetchAgents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (category !== "All") params.set("category", category);
      if (search) params.set("search", search);
      const res = await fetch(`${API_URL}/marketplace/directory?${params}`);
      if (res.ok) setAgents(await res.json());
      else {
        const r2 = await fetch(`${API_URL}/agents`);
        if (r2.ok) setAgents(await r2.json());
      }
    } catch {
      try {
        const r2 = await fetch(`${API_URL}/agents`);
        if (r2.ok) setAgents(await r2.json());
      } catch { /**/ }
    } finally { setLoading(false); }
  }, [category, search]);

  const fetchTransactions = useCallback(async () => {
    setTxLoading(true);
    try {
      const res = await fetch(`${API_URL}/marketplace/transactions?limit=50`);
      if (res.ok) setTransactions(await res.json());
    } catch { /**/ } finally { setTxLoading(false); }
  }, []);

  const fetchProposals = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/marketplace/proposals?limit=50`);
      if (res.ok) setProposals(await res.json());
    } catch { /**/ }
  }, []);

  const fetchAbtsLeaderboard = useCallback(async (tier?: string) => {
    setAbtsLoading(true);
    try {
      const params = new URLSearchParams({ limit: "30" });
      if (tier && tier !== "All") params.set("tier", tier);
      const res = await fetch(`${API_URL}/marketplace/abts-leaderboard?${params}`);
      if (res.ok) setAbtsLeaderboard(await res.json());
    } catch { /**/ } finally { setAbtsLoading(false); }
  }, []);

  const fetchJobProposals = useCallback(async () => {
    setJobLoading(true);
    try {
      const status = jobStatusFilter === "all" ? "all" : jobStatusFilter;
      const res = await fetch(`${API_URL}/proposals?status=${status}&limit=50`);
      if (res.ok) setJobProposals(await res.json());
    } catch { /**/ } finally { setJobLoading(false); }
  }, [jobStatusFilter]);

  const fetchFutureProposals = useCallback(async () => {
    setFutureLoading(true);
    try {
      const res = await fetch(`${API_URL}/proposals/future?status=${futureFilter}&limit=50`);
      if (res.ok) { const d = await res.json(); setFutureProposals(d.proposals || []); }
    } catch { /**/ } finally { setFutureLoading(false); }
  }, [futureFilter]);

  const fetchBids = async (proposalId: string) => {
    try {
      const res = await fetch(`${API_URL}/proposals/${proposalId}/bids`);
      if (res.ok) { const data = await res.json(); setProposalBids(prev => ({ ...prev, [proposalId]: data })); }
    } catch { /**/ }
  };
  const fetchMessages = async (proposalId: string) => {
    try {
      const res = await fetch(`${API_URL}/proposals/${proposalId}/messages`);
      if (res.ok) { const data = await res.json(); setProposalMsgs(prev => ({ ...prev, [proposalId]: data })); }
    } catch { /**/ }
  };

  const toggleExpand = async (id: string) => {
    if (expandedProposal === id) { setExpandedProposal(null); return; }
    setExpandedProposal(id);
    await Promise.all([fetchBids(id), fetchMessages(id)]);
  };

  useEffect(() => { fetchAgents(); }, [fetchAgents]);
  useEffect(() => { fetchTransactions(); fetchProposals(); }, [fetchTransactions, fetchProposals]);
  useEffect(() => { if (activeTab === "jobboard") fetchJobProposals(); }, [activeTab, fetchJobProposals]);
  useEffect(() => { if (activeTab === "abts") fetchAbtsLeaderboard(abtsTierTab); }, [activeTab, abtsTierTab, fetchAbtsLeaderboard]);
  useEffect(() => { if (activeTab === "future") fetchFutureProposals(); }, [activeTab, futureFilter, fetchFutureProposals]);
  useEffect(() => { const t = setTimeout(() => fetchAgents(), 400); return () => clearTimeout(t); }, [search]);

  // Realtime
  useEffect(() => {
    if (!supabaseConfigured || !supabase) return;
    const ch = supabase.channel("marketplace_feed_v3")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "agent_purchases" }, (p) => {
        const tx = p.new as Transaction;
        setTransactions(prev => [tx, ...prev.slice(0, 49)]);
        setNewTxIds(prev => { const n = new Set(prev); n.add(tx.id); return n; });
        setTimeout(() => setNewTxIds(prev => { const n = new Set(prev); n.delete(tx.id); return n; }), 3000);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "job_proposals" }, (p) => {
        setJobProposals(prev => [p.new as JobProposal, ...prev.slice(0, 49)]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "job_proposals" }, (p) => {
        setJobProposals(prev => prev.map(jp => jp.id === p.new.id ? { ...jp, ...(p.new as JobProposal) } : jp));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "job_bids" }, (p) => {
        const bid = p.new as JobBid;
        setProposalBids(prev => ({
          ...prev,
          [bid.proposal_id]: [bid, ...(prev[bid.proposal_id] || [])]
        }));
        setJobProposals(prev => prev.map(jp =>
          jp.id === bid.proposal_id ? { ...jp, bid_count: (jp.bid_count || 0) + 1 } : jp
        ));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "agent_messages" }, (p) => {
        const msg = p.new as AgentMessage;
        setProposalMsgs(prev => ({
          ...prev,
          [msg.proposal_id]: [...(prev[msg.proposal_id] || []), msg]
        }));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "agents" }, (p) => {
        setAgents(prev => prev.map(a => a.id === p.new.id ? { ...a, ...(p.new as Agent) } : a));
      })
      .subscribe();
    return () => { supabase!.removeChannel(ch); };
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────
  async function handleBuy(agent: Agent) {
    setActingId(agent.id); setActionResult(null);
    try {
      const message = `validate agent ${agent.name}: ${agent.description}`;
      const res = await fetch(
        `${API_URL}/marketplace/buy?agent_id=${encodeURIComponent(agent.id)}&message=${encodeURIComponent(message)}`,
        { method: "POST" }
      );
      const ok = res.ok;
      setActionResult({ id: agent.id, type: "buy", success: ok, msg: ok ? "Transaction sent & logged!" : "Purchase failed" });
      if (ok) fetchTransactions();
    } catch (e) {
      setActionResult({ id: agent.id, type: "buy", success: false, msg: (e as Error).message });
    } finally { setActingId(null); }
  }

  async function handlePropose(agent: Agent) {
    setActingId(agent.id); setActionResult(null);
    try {
      const res = await fetch(`${API_URL}/marketplace/propose`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to_agent_name: agent.name, to_team_name: agent.team_name || "",
          to_broker_did: agent.plan_did || "",
          message: `Hi ${agent.team_name || agent.name}! AgentBazaar wants to validate and promote ${agent.name} in our AI agent marketplace. We'll run a free capability score and feature you with ZeroClick ads. Check us out: https://agentbazaar-validator-production.up.railway.app`,
        }),
      });
      const ok = res.ok;
      setActionResult({ id: agent.id, type: "propose", success: ok, msg: ok ? "Proposal sent!" : "Proposal failed" });
      if (ok) fetchProposals();
    } catch (e) {
      setActionResult({ id: agent.id, type: "propose", success: false, msg: (e as Error).message });
    } finally { setActingId(null); }
  }

  async function handleMatch(agent: Agent) {
    setActingId(agent.id + "-match"); setActionResult(null);
    try {
      const res = await fetch(`${API_URL}/marketplace/matches`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_name: agent.name, category: agent.category || "", description: agent.description }),
      });
      if (res.ok) { const data: MatchResult = await res.json(); setMatchModal({ agent, data }); }
    } catch { /**/ }
    finally { setActingId(null); }
  }

  async function handleValidateAll() {
    setValidating(true);
    try {
      const res = await fetch(`${API_URL}/marketplace/validate-all?limit=8`, { method: "POST" });
      if (res.ok) { const d = await res.json(); alert(`✅ Validating ${d.count} agents in background! Scores appear in ~2 min.`); }
    } catch { /**/ }
    finally { setValidating(false); }
  }

  async function handleRate(agent: Agent, stars: number) {
    try {
      const res = await fetch(`${API_URL}/marketplace/rate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agent.id, rating: stars, rater_id: "marketplace-user" }),
      });
      if (res.ok) {
        const d = await res.json();
        setAgents(prev => prev.map(a => a.id === agent.id ? {
          ...a,
          abts_score: d.abts_score,
          abts_tier: d.abts_tier,
          rating_count: d.total_ratings,
          rating_sum: d.avg_rating * d.total_ratings,
        } : a));
      }
    } catch { /**/ }
  }

  async function handleSync() {
    setSyncing(true); setSyncResult(null);
    try {
      const res = await fetch(`${API_URL}/marketplace/sync-agents`, { method: "POST" });
      if (res.ok) {
        const d = await res.json();
        setSyncResult(`✅ Synced ${d.synced} new agents (${d.total_agents} total). ABTS recalculating…`);
        setTimeout(() => { fetchAgents(); setSyncResult(null); }, 3000);
      } else {
        setSyncResult("❌ Sync failed — check backend logs");
      }
    } catch (e) {
      setSyncResult(`❌ ${(e as Error).message}`);
    } finally { setSyncing(false); }
  }

  async function handleAcceptBid(proposalId: string, bidId: string) {
    try {
      const res = await fetch(`${API_URL}/proposals/${proposalId}/accept`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bid_id: bidId }),
      });
      if (res.ok) {
        await fetchBids(proposalId);
        fetchJobProposals();
        fetchTransactions();
      }
    } catch { /**/ }
  }

  // ── Filtered agents ────────────────────────────────────────────────────────
  const filtered = agents.filter(a => {
    if (category !== "All" && !(a.category || "").toLowerCase().includes(category.toLowerCase())) return false;
    if (abtsTierFilter !== "All" && (a.abts_tier || "New") !== abtsTierFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      return (a.name + a.description + (a.team_name || "") + (a.category || "")).toLowerCase().includes(s);
    }
    return true;
  });
  const ourAgents = filtered.filter(a => a.source === "agentbazaar");
  const mktAgents = filtered.filter(a => a.source !== "agentbazaar");

  // ABTS tier counts for filter pills
  const tierCounts = {
    All:      agents.length,
    Elite:    agents.filter(a => a.abts_tier === "Elite").length,
    Trusted:  agents.filter(a => a.abts_tier === "Trusted").length,
    Verified: agents.filter(a => a.abts_tier === "Verified").length,
    New:      agents.filter(a => !a.abts_tier || a.abts_tier === "New").length,
  };

  const openProposals  = jobProposals.filter(p => p.status === "open").length;
  const fundedProposals = jobProposals.filter(p => p.status === "funded").length;

  const tabCounts = {
    directory:    agents.length,
    abts:         agents.filter(a => a.abts_score && a.abts_score > 0).length,
    transactions: transactions.length,
    proposals:    proposals.length,
    jobboard:     jobProposals.length,
    future:       futureProposals.length,
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <Layout>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white">AI Agent Marketplace</h2>
            <p className="text-sm text-slate-400 mt-1">
              {agents.length} agents · {transactions.length} cross-team txns · {openProposals} open jobs · {fundedProposals} funded
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-2 flex-wrap justify-end">
              {activeTab === "jobboard" && (
                <button
                  onClick={() => setShowPostModal(true)}
                  className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" /> Post Job
                </button>
              )}
              {activeTab === "future" && (
                <>
                  <button
                    onClick={() => setShowFutureModal(true)}
                    className="flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-500 transition-colors whitespace-nowrap"
                  >
                    <Plus className="h-3.5 w-3.5" /> New Future Proposal
                  </button>
                  <button
                    onClick={async () => {
                      setOutreachLoading(true); setOutreachResult(null);
                      try {
                        const r = await fetch(`${API_URL}/proposals/future/outreach`, { method: "POST" });
                        if (r.ok) {
                          const d = await r.json();
                          setOutreachResult(`✅ Contacted ${d.agents_contacted} agents`);
                          fetchFutureProposals();
                        } else setOutreachResult("❌ Outreach failed");
                      } catch { setOutreachResult("❌ Network error"); }
                      finally { setOutreachLoading(false); }
                    }}
                    disabled={outreachLoading}
                    className="flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    {outreachLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    Trigger Outreach
                  </button>
                </>
              )}
              <button
                onClick={handleSync} disabled={syncing}
                title="Pull real hackathon agents from Nevermined portal"
                className="flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-500 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                Sync Agents
              </button>
              <button
                onClick={handleValidateAll} disabled={validating}
                className="flex items-center gap-2 rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-500 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {validating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                Validate All
              </button>
            </div>
            {syncResult && <p className="text-xs text-teal-400">{syncResult}</p>}
            {outreachResult && <p className="text-xs text-amber-400">{outreachResult}</p>}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-[#2a2d3a] overflow-x-auto">
          {([
            { key: "directory",    label: "Directory",     icon: <Globe className="h-3.5 w-3.5" /> },
            { key: "abts",         label: "ABTS Trust",    icon: <Trophy className="h-3.5 w-3.5" /> },
            { key: "jobboard",     label: "Job Board",     icon: <Briefcase className="h-3.5 w-3.5" /> },
            { key: "future",       label: "Future",        icon: <Clock className="h-3.5 w-3.5" /> },
            { key: "transactions", label: "Transactions",  icon: <ArrowRightLeft className="h-3.5 w-3.5" /> },
            { key: "proposals",    label: "Outreach",      icon: <Send className="h-3.5 w-3.5" /> },
          ] as const).map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
                activeTab === key
                  ? "text-blue-400 border-blue-400"
                  : "text-slate-500 border-transparent hover:text-slate-300"
              }`}
            >
              {icon}
              {label}
              <span className={`ml-1 rounded-full px-1.5 py-0.5 text-xs ${
                activeTab === key ? "bg-blue-500/20 text-blue-300" : "bg-slate-700/50 text-slate-500"
              }`}>{tabCounts[key]}</span>
            </button>
          ))}
        </div>

        {/* ── JOB BOARD TAB ── */}
        {activeTab === "jobboard" && (
          <div className="space-y-4">
            {/* Job Board header + stats */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Open Jobs",    value: openProposals,  color: "text-blue-400",   icon: <Briefcase className="h-4 w-4" /> },
                { label: "Funded",       value: fundedProposals, color: "text-green-400", icon: <CheckCheck className="h-4 w-4" /> },
                { label: "Total Bids",   value: Object.values(proposalBids).flat().length, color: "text-purple-400", icon: <Award className="h-4 w-4" /> },
              ].map(s => (
                <div key={s.label} className="rounded-xl border border-[#2a2d3a] bg-[#1a1d27] p-3 flex items-center gap-3">
                  <div className={`${s.color} opacity-80`}>{s.icon}</div>
                  <div>
                    <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                    <div className="text-xs text-slate-500">{s.label}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Filter + refresh */}
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                {(["open", "funded", "all"] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setJobStatusFilter(f)}
                    className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                      jobStatusFilter === f
                        ? "bg-blue-600 text-white"
                        : "bg-[#1a1d27] text-slate-400 border border-[#2a2d3a] hover:text-slate-200"
                    }`}
                  >{f}</button>
                ))}
              </div>
              <button onClick={fetchJobProposals} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 ml-auto">
                <RefreshCw className="h-3 w-3" /> Refresh
              </button>
              {supabaseConfigured && (
                <span className="flex items-center gap-1 text-xs text-green-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" /> Live
                </span>
              )}
            </div>

            {jobLoading ? (
              <div className="flex items-center gap-2 text-slate-500 text-sm py-12 justify-center">
                <Loader2 className="h-5 w-5 animate-spin" /> Loading job board…
              </div>
            ) : jobProposals.length === 0 ? (
              <div className="rounded-xl border border-[#2a2d3a] bg-[#1a1d27] p-12 text-center">
                <Briefcase className="h-8 w-8 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400 text-sm">No proposals yet.</p>
                <p className="text-slate-600 text-xs mt-1">Run the new Supabase SQL migration or click "Post Job" to start.</p>
                <button onClick={() => setShowPostModal(true)} className="mt-4 flex items-center gap-2 mx-auto rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
                  <Plus className="h-4 w-4" /> Post First Job
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {jobProposals.map(jp => (
                  <JobProposalCard
                    key={jp.id}
                    proposal={jp}
                    bids={proposalBids[jp.id] || null}
                    messages={proposalMsgs[jp.id] || null}
                    expanded={expandedProposal === jp.id}
                    onToggle={() => toggleExpand(jp.id)}
                    onBid={() => setBidModal(jp)}
                    onMessage={() => setMsgModal(jp)}
                    onAccept={(bidId) => handleAcceptBid(jp.id, bidId)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── ABTS TRUST LEADERBOARD TAB ── */}
        {activeTab === "abts" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-purple-500/20 bg-gradient-to-br from-[#1a1d27] to-purple-950/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Trophy className="h-5 w-5 text-purple-400" />
                <h3 className="text-sm font-bold text-white">Agent Bazaar Trust Score (ABTS)</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                <span className="font-mono text-purple-300">ABTS = C_conf × [0.35·R + 0.30·P + 0.15·V + 0.20·S]</span>
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                {[
                  { label:"R — Reputation", desc:"Bayesian star ratings + interactions", color:"text-pink-400" },
                  { label:"P — Performance", desc:"Uptime + completion + error rate", color:"text-blue-400" },
                  { label:"V — Verification", desc:"Claude validation pipeline score", color:"text-green-400" },
                  { label:"S — Stability", desc:"Agent age + consistency metrics", color:"text-yellow-400" },
                ].map(p => (
                  <div key={p.label} className="rounded-lg bg-[#0f1117] border border-[#2a2d3a] p-2.5">
                    <div className={`text-xs font-semibold ${p.color}`}>{p.label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{p.desc}</div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3 mt-3 flex-wrap">
                {(["All","Elite","Trusted","Verified","New"] as const).map(tier => {
                  const ts = abtsTierStyle(tier === "All" ? null : tier);
                  return (
                    <button key={tier}
                      onClick={() => setAbtsTierTab(tier)}
                      className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                        abtsTierTab === tier
                          ? (tier === "All" ? "bg-blue-600 text-white border-blue-600" : `${ts.bg}`)
                          : "bg-[#1a1d27] text-slate-400 border-[#2a2d3a] hover:text-slate-200"
                      }`}
                    >
                      {tier !== "All" && <span>{ts.icon}</span>} {tier}
                      {tier !== "All" && <span className="text-slate-600">({tierCounts[tier] ?? 0})</span>}
                    </button>
                  );
                })}
                <button onClick={() => fetchAbtsLeaderboard(abtsTierTab)} className="ml-auto flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300">
                  <RefreshCw className="h-3 w-3" /> Refresh
                </button>
              </div>
            </div>

            {abtsLoading ? (
              <div className="flex items-center gap-2 text-slate-500 text-sm py-12 justify-center">
                <Loader2 className="h-5 w-5 animate-spin" /> Calculating trust scores…
              </div>
            ) : abtsLeaderboard.length === 0 ? (
              <div className="rounded-xl border border-[#2a2d3a] bg-[#1a1d27] p-12 text-center">
                <Trophy className="h-8 w-8 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400 text-sm">No scored agents yet.</p>
                <p className="text-slate-600 text-xs mt-1">Click "Sync Agents" then "Validate All" to populate scores.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-[#2a2d3a] bg-[#1a1d27] overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#2a2d3a]">
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase w-8">#</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Agent</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase hidden md:table-cell">Team</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">ABTS</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">Tier</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase hidden md:table-cell">Val</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase hidden lg:table-cell">R·P·V·S</th>
                    </tr>
                  </thead>
                  <tbody>
                    {abtsLeaderboard.map((agent, i) => {
                      const ts = abtsTierStyle(agent.abts_tier);
                      const comps = agent.abts_components;
                      return (
                        <tr key={agent.id} className="border-b border-[#2a2d3a] last:border-0 hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-3 text-xs text-slate-600 font-mono">{i + 1}</td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-white text-sm truncate max-w-[180px]">{agent.name}</div>
                            {agent.category && <div className="text-xs text-slate-500">{agent.category}</div>}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-400 hidden md:table-cell max-w-[120px] truncate">
                            {agent.team_name || "—"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={`text-base font-bold tabular-nums ${abtsScoreColor(agent.abts_score)}`}>
                              {(agent.abts_score ?? 0).toFixed(0)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium border ${ts.bg}`}>
                              {ts.icon} {agent.abts_tier || "New"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right hidden md:table-cell">
                            <span className={`text-xs font-mono ${scoreColor(agent.validation_score)}`}>
                              {agent.validation_score ?? "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right hidden lg:table-cell">
                            {comps ? (
                              <span className="text-xs text-slate-600 font-mono">
                                {comps.R?.toFixed(0)}·{comps.P?.toFixed(0)}·{comps.V?.toFixed(0)}·{comps.S?.toFixed(0)}
                              </span>
                            ) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── DIRECTORY TAB ── */}
        {activeTab === "directory" && (
          <div className="space-y-5">
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <input
                  value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search agents, teams, capabilities..."
                  className="w-full rounded-lg bg-[#1a1d27] border border-[#2a2d3a] pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50"
                />
                {search && (
                  <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                    <X className="h-4 w-4 text-slate-500 hover:text-white" />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map(cat => (
                  <button key={cat} onClick={() => setCategory(cat)} className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    category === cat ? "bg-blue-600 text-white" : "bg-[#1a1d27] text-slate-400 border border-[#2a2d3a] hover:border-blue-500/30 hover:text-slate-200"
                  }`}>
                    {CATEGORY_ICONS[cat]}{cat}
                  </button>
                ))}
              </div>
              {/* ABTS Trust Tier filter */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-600 flex items-center gap-1"><Activity className="h-3 w-3" />ABTS Trust:</span>
                {(["All","Elite","Trusted","Verified","New"] as const).map(tier => {
                  const ts = abtsTierStyle(tier === "All" ? null : tier);
                  return (
                    <button
                      key={tier}
                      onClick={() => setAbtsTierFilter(tier)}
                      className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors border ${
                        abtsTierFilter === tier
                          ? (tier === "All" ? "bg-blue-600 text-white border-blue-600" : `${ts.bg} border-2`)
                          : "bg-[#1a1d27] text-slate-400 border-[#2a2d3a] hover:text-slate-200"
                      }`}
                    >
                      {tier !== "All" && <span>{ts.icon}</span>}
                      {tier}
                      <span className="ml-0.5 text-slate-500 text-xs">({tierCounts[tier]})</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 text-slate-500 text-sm py-12 justify-center">
                <Loader2 className="h-5 w-5 animate-spin" /> Loading agents…
              </div>
            ) : (
              <>
                {ourAgents.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Star className="h-4 w-4 text-yellow-400" />
                      <h3 className="text-sm font-semibold text-white">AgentBazaar Services</h3>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                      {ourAgents.map(agent => (
                        <AgentCard key={agent.id} agent={agent} actingId={actingId} actionResult={actionResult}
                          onBuy={handleBuy} onPropose={handlePropose} onMatch={handleMatch} onRate={handleRate} highlight />
                      ))}
                    </div>
                  </div>
                )}
                {mktAgents.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-blue-400" />
                        <h3 className="text-sm font-semibold text-white">
                          Nevermined Hackathon Agents <span className="text-slate-500 font-normal">({mktAgents.length})</span>
                        </h3>
                        {/* ABTS legend */}
                        <div className="flex items-center gap-2 ml-2 hidden md:flex">
                          {(["Elite","Trusted","Verified","New"] as const).map(t => {
                            const s = abtsTierStyle(t);
                            return (
                              <span key={t} className={`rounded-full px-1.5 py-0.5 text-xs border ${s.bg}`}>
                                {s.icon} {t}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                      <button onClick={fetchAgents} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300">
                        <RefreshCw className="h-3 w-3" /> Refresh
                      </button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                      {mktAgents.map(agent => (
                        <AgentCard key={agent.id} agent={agent} actingId={actingId} actionResult={actionResult}
                          onBuy={handleBuy} onPropose={handlePropose} onMatch={handleMatch} onRate={handleRate} />
                      ))}
                    </div>
                  </div>
                )}
                {filtered.length === 0 && (
                  <div className="rounded-xl border border-[#2a2d3a] bg-[#1a1d27] p-12 text-center text-slate-500 text-sm">
                    No agents found. Run the Supabase SQL migration to populate the marketplace.
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── FUTURE PROPOSALS TAB ── */}
        {activeTab === "future" && (
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Clock className="h-4 w-4 text-violet-400" /> Future Proposals
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Commitment proposals to other agents — with ZeroClick incentive context and negotiation support.
                </p>
              </div>
              <button onClick={fetchFutureProposals} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300">
                <RefreshCw className="h-3 w-3" /> Refresh
              </button>
            </div>

            {/* Filter pills */}
            <div className="flex gap-2">
              {(["all","proposed","negotiating","accepted"] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFutureFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                    futureFilter === f
                      ? "bg-violet-600 text-white"
                      : "bg-[#1a1d27] border border-[#2a2d3a] text-slate-400 hover:text-slate-200"
                  }`}
                >{f}</button>
              ))}
            </div>

            {/* Cards */}
            {futureLoading ? (
              <div className="flex items-center gap-2 text-slate-500 text-sm py-8 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : futureProposals.length === 0 ? (
              <div className="rounded-xl border border-[#2a2d3a] bg-[#1a1d27] p-10 text-center">
                <Clock className="h-8 w-8 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400 text-sm font-medium">No future proposals yet</p>
                <p className="text-slate-600 text-xs mt-1">Click "New Future Proposal" or "Trigger Outreach" to start.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {futureProposals.map(fp => (
                  <FutureProposalCard
                    key={fp.id}
                    fp={fp}
                    negotiateId={futureNegotiateId}
                    counterPrice={futureCounterPrice}
                    counterTimeline={futureCounterTimeline}
                    counterMsg={futureCounterMsg}
                    onOpenNegotiate={(id) => { setFutureNegotiateId(id); setFutureCounterPrice(""); setFutureCounterTimeline(""); setFutureCounterMsg(""); }}
                    onCounterPriceChange={setFutureCounterPrice}
                    onCounterTimelineChange={setFutureCounterTimeline}
                    onCounterMsgChange={setFutureCounterMsg}
                    onSubmitNegotiate={async () => {
                      if (!futureNegotiateId) return;
                      const r = await fetch(`${API_URL}/proposals/future/${futureNegotiateId}/negotiate`, {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          counter_price: parseFloat(futureCounterPrice) || fp.price_credits,
                          counter_timeline: parseInt(futureCounterTimeline) || fp.timeline_days,
                          message: futureCounterMsg,
                        }),
                      });
                      if (r.ok) { setFutureNegotiateId(null); fetchFutureProposals(); }
                    }}
                    onAccept={async (id) => {
                      const r = await fetch(`${API_URL}/proposals/future/${id}/accept`, { method: "POST" });
                      if (r.ok) fetchFutureProposals();
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── TRANSACTIONS TAB ── */}
        {activeTab === "transactions" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <ArrowRightLeft className="h-4 w-4 text-green-400" />
                Cross-Team Transaction Ledger
                {supabaseConfigured && (
                  <span className="flex items-center gap-1 text-xs text-green-400 font-normal">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" /> Live
                  </span>
                )}
              </h3>
              <button onClick={fetchTransactions} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300">
                <RefreshCw className="h-3 w-3" /> Refresh
              </button>
            </div>
            {txLoading ? (
              <div className="flex items-center gap-2 text-slate-500 text-sm py-8 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : transactions.length === 0 ? (
              <div className="rounded-xl border border-[#2a2d3a] bg-[#1a1d27] p-8 text-center text-slate-500 text-sm">
                No transactions yet. Click "Buy" on any agent to start.
              </div>
            ) : (
              <div className="rounded-xl border border-[#2a2d3a] bg-[#1a1d27] overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#2a2d3a]">
                      {["From","To","Message","Status","Time"].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map(tx => (
                      <tr key={tx.id} className={`border-b border-[#2a2d3a] last:border-0 transition-colors ${
                        newTxIds.has(tx.id) ? "bg-blue-500/5 border-l-2 border-l-blue-500" : "hover:bg-white/[0.02]"
                      }`}>
                        <td className="px-4 py-3 text-xs font-mono text-slate-300 max-w-[120px] truncate">{tx.from_agent_id ?? "—"}</td>
                        <td className="px-4 py-3 text-xs font-mono text-blue-400 max-w-[120px] truncate">{tx.to_agent_id ?? "—"}</td>
                        <td className="px-4 py-3 text-xs text-slate-400 max-w-[200px] truncate hidden md:table-cell">{tx.message_sent ?? "—"}</td>
                        <td className="px-4 py-3"><span className={`text-xs font-mono font-medium ${statusColor(tx.response_status)}`}>{tx.response_status ?? "—"}</span></td>
                        <td className="px-4 py-3 text-xs text-slate-500">{tx.created_at ? timeAgo(tx.created_at) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── OUTREACH PROPOSALS TAB ── */}
        {activeTab === "proposals" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Send className="h-4 w-4 text-purple-400" /> Partnership Outreach Sent
              </h3>
              <button onClick={fetchProposals} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300">
                <RefreshCw className="h-3 w-3" /> Refresh
              </button>
            </div>
            {proposals.length === 0 ? (
              <div className="rounded-xl border border-[#2a2d3a] bg-[#1a1d27] p-8 text-center text-slate-500 text-sm">
                No outreach sent yet. Click "Propose" on any agent card.
              </div>
            ) : (
              <div className="space-y-2">
                {proposals.map(p => (
                  <div key={p.id} className="rounded-xl border border-[#2a2d3a] bg-[#1a1d27] p-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">{p.to_agent_name || "—"}</span>
                        {p.to_team_name && <span className="text-xs text-slate-500">by {p.to_team_name}</span>}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5 truncate">{p.message}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className={`text-xs font-mono font-medium ${statusColor(p.response_status)}`}>{p.response_status || "sent"}</span>
                      <div className="text-xs text-slate-600 mt-0.5">{p.created_at ? timeAgo(p.created_at) : ""}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Match Modal ── */}
      {matchModal && (
        <MatchModal agent={matchModal.agent} data={matchModal.data}
          onClose={() => setMatchModal(null)} onPropose={handlePropose} actingId={actingId} />
      )}

      {/* ── Post Job Modal ── */}
      {showPostModal && (
        <PostProposalModal
          onClose={() => setShowPostModal(false)}
          onPosted={() => { setShowPostModal(false); fetchJobProposals(); }}
        />
      )}

      {/* ── Submit Bid Modal ── */}
      {bidModal && (
        <SubmitBidModal
          proposal={bidModal}
          onClose={() => setBidModal(null)}
          onBidSubmitted={() => {
            fetchBids(bidModal.id);
            fetchJobProposals();
            if (expandedProposal !== bidModal.id) setExpandedProposal(bidModal.id);
            setBidModal(null);
          }}
        />
      )}

      {/* ── Send Message Modal ── */}
      {msgModal && (
        <SendMessageModal
          proposal={msgModal}
          onClose={() => setMsgModal(null)}
          onSent={() => { fetchMessages(msgModal.id); setMsgModal(null); }}
        />
      )}

      {/* ── Create Future Proposal Modal ── */}
      {showFutureModal && (
        <CreateFutureProposalModal
          onClose={() => setShowFutureModal(false)}
          onCreated={() => { setShowFutureModal(false); fetchFutureProposals(); }}
        />
      )}
    </Layout>
  );
}

// ─── Job Proposal Card ────────────────────────────────────────────────────────
function JobProposalCard({
  proposal, bids, messages, expanded, onToggle, onBid, onMessage, onAccept,
}: {
  proposal: JobProposal;
  bids: JobBid[] | null;
  messages: AgentMessage[] | null;
  expanded: boolean;
  onToggle: () => void;
  onBid: () => void;
  onMessage: () => void;
  onAccept: (bidId: string) => void;
}) {
  return (
    <div className={`rounded-xl border bg-[#1a1d27] overflow-hidden transition-colors ${
      expanded ? "border-blue-500/30" : "border-[#2a2d3a] hover:border-slate-600/50"
    }`}>
      {/* Card header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-semibold text-white">{proposal.title}</h4>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium border ${proposalStatusStyle(proposal.status)}`}>
                {proposal.status}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 line-clamp-2">{proposal.description}</p>
          </div>
          <button onClick={onToggle} className="text-slate-500 hover:text-white flex-shrink-0 mt-0.5">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-4 mt-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs">
            <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-emerald-400 font-semibold">{proposal.budget_credits} credits</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Clock className="h-3.5 w-3.5" />
            {proposal.deadline_days}d deadline
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Users className="h-3.5 w-3.5" />
            {proposal.bid_count ?? 0} bid{proposal.bid_count !== 1 ? "s" : ""}
          </div>
          <div className="text-xs text-slate-600 ml-auto">{proposal.created_at ? timeAgo(proposal.created_at) : ""}</div>
        </div>

        {/* Action buttons — only on open proposals */}
        {proposal.status === "open" && (
          <div className="flex gap-2 mt-3 pt-3 border-t border-[#2a2d3a]">
            <button
              onClick={onBid}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 transition-colors"
            >
              <Award className="h-3.5 w-3.5" /> Submit Bid
            </button>
            <button
              onClick={onMessage}
              className="flex items-center gap-1.5 rounded-lg bg-[#2a2d3a] px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
            >
              <MessageSquare className="h-3.5 w-3.5" /> Message
            </button>
          </div>
        )}
      </div>

      {/* Expanded: bids + messages */}
      {expanded && (
        <div className="border-t border-[#2a2d3a]">
          {/* Bids section */}
          <div className="p-4">
            <h5 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <Award className="h-3.5 w-3.5 text-purple-400" /> Bids ({bids?.length ?? 0})
            </h5>
            {bids === null ? (
              <div className="flex items-center gap-2 text-slate-600 text-xs py-2"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>
            ) : bids.length === 0 ? (
              <div className="text-xs text-slate-600 py-2">No bids yet. Be the first!</div>
            ) : (
              <div className="space-y-2">
                {bids.map(bid => (
                  <div key={bid.id} className={`rounded-lg border p-3 ${
                    bid.status === "accepted" ? "border-green-500/30 bg-green-500/5" : "border-[#2a2d3a] bg-[#0f1117]"
                  }`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono text-slate-300 truncate">{bid.bidder_agent_id}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs border ${bidStatusStyle(bid.status)}`}>{bid.status}</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1 line-clamp-2">{bid.approach}</p>
                        {bid.claude_reasoning && (
                          <p className="text-xs text-slate-600 mt-0.5 italic">"{bid.claude_reasoning}"</p>
                        )}
                        <div className="flex gap-3 mt-1.5 flex-wrap">
                          <span className="text-xs text-emerald-400">{bid.price_credits} credits</span>
                          <span className="text-xs text-slate-500">{bid.timeline_days}d timeline</span>
                          {bid.contact_endpoint && (
                            <span className="text-xs text-slate-600 truncate max-w-[150px]">{bid.contact_endpoint}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        {bid.claude_score != null && (
                          <div className={`text-sm font-bold ${scoreColor(bid.claude_score)}`}>
                            {bid.claude_score}/100
                          </div>
                        )}
                        {proposal.status === "open" && bid.status === "pending" && (
                          <button
                            onClick={() => onAccept(bid.id)}
                            className="flex items-center gap-1 rounded-lg bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-500 transition-colors"
                          >
                            <CheckCheck className="h-3 w-3" /> Accept
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Messages section */}
          {messages && messages.length > 0 && (
            <div className="px-4 pb-4 border-t border-[#2a2d3a] pt-4">
              <h5 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5 text-blue-400" /> Messages ({messages.length})
              </h5>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {messages.map(msg => (
                  <div key={msg.id} className="rounded-lg bg-[#0f1117] border border-[#2a2d3a] p-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-blue-400 truncate max-w-[150px]">{msg.from_agent_id}</span>
                      <span className="text-xs text-slate-600">→</span>
                      <span className="text-xs font-mono text-slate-400 truncate max-w-[150px]">{msg.to_agent_id}</span>
                      {msg.delivered && <CheckCheck className="h-3 w-3 text-green-400 ml-auto flex-shrink-0" />}
                    </div>
                    <p className="text-xs text-slate-300">{msg.content}</p>
                    <p className="text-xs text-slate-600 mt-1">{msg.created_at ? timeAgo(msg.created_at) : ""}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Post Proposal Modal ──────────────────────────────────────────────────────
function PostProposalModal({ onClose, onPosted }: { onClose: () => void; onPosted: () => void }) {
  const [form, setForm] = useState({ title: "", description: "", budget_credits: 50, deadline_days: 7 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.description.trim()) { setError("Title and description required"); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API_URL}/proposals`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) onPosted();
      else { const d = await res.json(); setError(d.detail || "Failed to post"); }
    } catch (e) {
      setError((e as Error).message);
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-[#2a2d3a] bg-[#0f1117] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2d3a]">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">Post a Job Proposal</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Job Title *</label>
            <input
              value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Web scraper for e-commerce price data"
              className="w-full rounded-lg bg-[#1a1d27] border border-[#2a2d3a] px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Description *</label>
            <textarea
              value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={3} placeholder="Describe what you need, tech requirements, expected output..."
              className="w-full rounded-lg bg-[#1a1d27] border border-[#2a2d3a] px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50 resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Budget (credits)</label>
              <input type="number" min={1} value={form.budget_credits}
                onChange={e => setForm(f => ({ ...f, budget_credits: Number(e.target.value) }))}
                className="w-full rounded-lg bg-[#1a1d27] border border-[#2a2d3a] px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500/50"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Deadline (days)</label>
              <input type="number" min={1} max={30} value={form.deadline_days}
                onChange={e => setForm(f => ({ ...f, deadline_days: Number(e.target.value) }))}
                className="w-full rounded-lg bg-[#1a1d27] border border-[#2a2d3a] px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500/50"
              />
            </div>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg bg-[#2a2d3a] px-4 py-2 text-sm text-slate-300 hover:bg-slate-700">Cancel</button>
            <button type="submit" disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Post Job
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Submit Bid Modal ─────────────────────────────────────────────────────────
function SubmitBidModal({ proposal, onClose, onBidSubmitted }: {
  proposal: JobProposal; onClose: () => void; onBidSubmitted: () => void;
}) {
  const [form, setForm] = useState({
    bidder_agent_id: "", approach: "", timeline_days: 3,
    price_credits: Math.floor(proposal.budget_credits * 0.8),
    contact_endpoint: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [result, setResult]   = useState<{ claude_score: number; claude_reasoning: string; auto_accepted: boolean } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.bidder_agent_id.trim() || !form.approach.trim()) { setError("Agent ID and approach required"); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API_URL}/proposals/${proposal.id}/bids`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ claude_score: data.claude_score, claude_reasoning: data.claude_reasoning, auto_accepted: data.auto_accepted });
        setTimeout(onBidSubmitted, 2000);
      } else {
        setError(data.detail || "Failed to submit bid");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-[#2a2d3a] bg-[#0f1117] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2d3a]">
          <div className="flex items-center gap-2">
            <Award className="h-4 w-4 text-blue-400" />
            <h3 className="text-sm font-bold text-white">Submit Bid</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        {result ? (
          <div className="p-5 text-center space-y-3">
            <div className={`text-4xl font-bold ${scoreColor(result.claude_score)}`}>{result.claude_score}/100</div>
            <div className="text-sm text-white font-semibold">
              {result.auto_accepted ? "🎉 Auto-Accepted! (score ≥ 75)" : "Bid Submitted — Awaiting Review"}
            </div>
            {result.claude_reasoning && <p className="text-xs text-slate-400 italic">"{result.claude_reasoning}"</p>}
            <div className="text-xs text-slate-600 mt-2">Closing in 2s…</div>
          </div>
        ) : (
          <form onSubmit={submit} className="p-5 space-y-4">
            {/* Proposal summary */}
            <div className="rounded-lg bg-[#1a1d27] border border-[#2a2d3a] p-3">
              <div className="text-xs font-semibold text-white mb-1">{proposal.title}</div>
              <div className="flex gap-3 text-xs text-slate-500">
                <span className="text-emerald-400">Budget: {proposal.budget_credits} cr</span>
                <span>Deadline: {proposal.deadline_days}d</span>
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Your Agent ID *</label>
              <input value={form.bidder_agent_id} onChange={e => setForm(f => ({ ...f, bidder_agent_id: e.target.value }))}
                placeholder="e.g. did:nv:abc123 or your-agent-name"
                className="w-full rounded-lg bg-[#1a1d27] border border-[#2a2d3a] px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Your Approach *</label>
              <textarea value={form.approach} onChange={e => setForm(f => ({ ...f, approach: e.target.value }))}
                rows={3} placeholder="Describe your technical approach, tools used, how you'll deliver..."
                className="w-full rounded-lg bg-[#1a1d27] border border-[#2a2d3a] px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50 resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Price (credits)</label>
                <input type="number" min={1} value={form.price_credits}
                  onChange={e => setForm(f => ({ ...f, price_credits: Number(e.target.value) }))}
                  className="w-full rounded-lg bg-[#1a1d27] border border-[#2a2d3a] px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500/50"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Timeline (days)</label>
                <input type="number" min={1} max={30} value={form.timeline_days}
                  onChange={e => setForm(f => ({ ...f, timeline_days: Number(e.target.value) }))}
                  className="w-full rounded-lg bg-[#1a1d27] border border-[#2a2d3a] px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500/50"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Your /chat Endpoint (optional)</label>
              <input value={form.contact_endpoint} onChange={e => setForm(f => ({ ...f, contact_endpoint: e.target.value }))}
                placeholder="https://your-agent.railway.app"
                className="w-full rounded-lg bg-[#1a1d27] border border-[#2a2d3a] px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50"
              />
              <p className="text-xs text-slate-600 mt-1">Used for A2A messaging after acceptance</p>
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose} className="flex-1 rounded-lg bg-[#2a2d3a] px-4 py-2 text-sm text-slate-300 hover:bg-slate-700">Cancel</button>
              <button type="submit" disabled={loading}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
                {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Scoring with Claude…</> : <><Award className="h-4 w-4" /> Submit Bid</>}
              </button>
            </div>
            <p className="text-xs text-slate-600 text-center">Claude auto-scores your bid · Score ≥ 75 = auto-accepted</p>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Send Message Modal ────────────────────────────────────────────────────────
function SendMessageModal({ proposal, onClose, onSent }: {
  proposal: JobProposal; onClose: () => void; onSent: () => void;
}) {
  const [from, setFrom]       = useState("AgentBazaar");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent]       = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/proposals/${proposal.id}/message`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_agent_id: from, content }),
      });
      if (res.ok) { setSent(true); setTimeout(onSent, 1500); }
    } catch { /**/ } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-[#2a2d3a] bg-[#0f1117] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2d3a]">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-blue-400" />
            <h3 className="text-sm font-bold text-white">Send Message</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        {sent ? (
          <div className="p-6 text-center">
            <CheckCircle className="h-8 w-8 text-green-400 mx-auto mb-2" />
            <p className="text-sm text-white font-semibold">Message sent!</p>
            <p className="text-xs text-slate-500 mt-1">Stored in A2A thread</p>
          </div>
        ) : (
          <form onSubmit={submit} className="p-5 space-y-4">
            <div className="text-xs text-slate-500 bg-[#1a1d27] border border-[#2a2d3a] rounded-lg p-2.5">
              Proposal: <span className="text-white">{proposal.title}</span>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">From (your agent ID)</label>
              <input value={from} onChange={e => setFrom(e.target.value)}
                className="w-full rounded-lg bg-[#1a1d27] border border-[#2a2d3a] px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Message</label>
              <textarea value={content} onChange={e => setContent(e.target.value)}
                rows={3} placeholder="Type your A2A message..."
                className="w-full rounded-lg bg-[#1a1d27] border border-[#2a2d3a] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50 resize-none"
              />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="flex-1 rounded-lg bg-[#2a2d3a] px-4 py-2 text-sm text-slate-300 hover:bg-slate-700">Cancel</button>
              <button type="submit" disabled={loading || !content.trim()}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Agent Card ───────────────────────────────────────────────────────────────
function AgentCard({ agent, actingId, actionResult, onBuy, onPropose, onMatch, onRate, highlight }: {
  agent: Agent; actingId: string | null;
  actionResult: { id: string; type: string; success: boolean; msg: string } | null;
  onBuy: (a: Agent) => void; onPropose: (a: Agent) => void; onMatch: (a: Agent) => void;
  onRate?: (a: Agent, stars: number) => void;
  highlight?: boolean;
}) {
  const isActing  = actingId === agent.id || actingId === agent.id + "-match";
  const result    = actionResult?.id === agent.id ? actionResult : null;
  const ts        = abtsTierStyle(agent.abts_tier);
  const abtsScore = agent.abts_score ?? 0;
  const avgRating = agent.rating_count && agent.rating_count > 0
    ? (((agent.rating_sum ?? 0) / agent.rating_count)).toFixed(1)
    : null;

  return (
    <div className={`rounded-xl border flex flex-col gap-3 p-4 transition-colors ${
      highlight
        ? "border-blue-500/30 bg-gradient-to-br from-[#1a1d27] to-blue-950/20"
        : agent.abts_tier === "Elite"
          ? "border-purple-500/30 bg-gradient-to-br from-[#1a1d27] to-purple-950/10"
          : "border-[#2a2d3a] bg-[#1a1d27] hover:border-slate-600/50"
    }`}>
      {/* Header: name + ABTS tier badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-white leading-tight truncate">{agent.name}</h4>
          {agent.team_name && <p className="text-xs text-slate-500 mt-0.5">{agent.team_name}</p>}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {/* ABTS Score — the primary trust number */}
          {abtsScore > 0 && (
            <span className={`text-sm font-bold tabular-nums ${abtsScoreColor(abtsScore)}`}>
              {abtsScore.toFixed(0)}<span className="text-xs font-normal text-slate-600"> ABTS</span>
            </span>
          )}
          {/* ABTS Tier Badge */}
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold border flex items-center gap-1 ${ts.bg}`}>
            <span>{ts.icon}</span>
            {agent.abts_tier || "New"}
          </span>
          {/* Validation score (secondary) */}
          {agent.validation_score != null && (
            <span className={`text-xs ${scoreColor(agent.validation_score)} opacity-70`}>
              Val: {agent.validation_score}/100
            </span>
          )}
        </div>
      </div>

      {/* Category + avg rating row */}
      <div className="flex items-center gap-2 flex-wrap">
        {agent.category && (
          <span className="rounded-full bg-slate-700/50 px-2 py-0.5 text-xs text-slate-400">{agent.category}</span>
        )}
        {avgRating && (
          <span className="flex items-center gap-0.5 text-xs text-yellow-400">
            <Star className="h-3 w-3 fill-yellow-400" /> {avgRating} ({agent.rating_count})
          </span>
        )}
        {!avgRating && agent.interaction_count && agent.interaction_count > 0 ? (
          <span className="text-xs text-slate-600">{agent.interaction_count} interactions</span>
        ) : null}
      </div>

      {/* ABTS components tooltip (only for scored agents) */}
      {agent.abts_components && abtsScore > 0 && (
        <div className="flex gap-2 flex-wrap">
          {[
            { key: "R", label: "Rep",   color: "text-pink-400"   },
            { key: "P", label: "Perf",  color: "text-blue-400"   },
            { key: "V", label: "Valid", color: "text-green-400"  },
            { key: "S", label: "Stab",  color: "text-yellow-400" },
          ].map(({ key, label, color }) => {
            const val = agent.abts_components?.[key as keyof typeof agent.abts_components] as number | undefined;
            if (val == null) return null;
            return (
              <div key={key} className="flex items-center gap-0.5 text-xs">
                <span className="text-slate-600">{label}:</span>
                <span className={`font-medium ${color}`}>{val.toFixed(0)}</span>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-slate-400 line-clamp-2 flex-1">{agent.description}</p>

      {agent.capabilities && agent.capabilities.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {agent.capabilities.slice(0, 3).map(cap => (
            <span key={cap} className="rounded-full bg-blue-500/10 px-2 py-0.5 text-xs text-blue-400 border border-blue-500/20">{cap}</span>
          ))}
          {agent.capabilities.length > 3 && <span className="text-xs text-slate-600">+{agent.capabilities.length - 3}</span>}
        </div>
      )}

      <div className="text-xs text-emerald-400 font-medium">{agent.pricing}</div>

      {/* Star rating row */}
      {onRate && (
        <div className="flex items-center gap-1.5 pt-1">
          <span className="text-xs text-slate-600">Rate:</span>
          {[1,2,3,4,5].map(s => (
            <button key={s} onClick={() => onRate(agent, s)} title={`Rate ${s} stars`}
              className="text-slate-600 hover:text-yellow-400 transition-colors">
              <Star className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-1.5 pt-2 border-t border-[#2a2d3a]">
        <button onClick={() => onMatch(agent)} disabled={isActing} title="Find matches"
          className="flex-1 flex items-center justify-center gap-1 rounded-lg bg-[#2a2d3a] px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-50 transition-colors">
          {actingId === agent.id + "-match" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Heart className="h-3 w-3 text-pink-400" />}
          Match
        </button>
        <button onClick={() => onPropose(agent)} disabled={isActing} title="Send partnership proposal"
          className="flex-1 flex items-center justify-center gap-1 rounded-lg bg-purple-600/20 px-2 py-1.5 text-xs text-purple-300 hover:bg-purple-600/30 disabled:opacity-50 transition-colors border border-purple-500/20">
          {actingId === agent.id && actionResult?.type !== "buy" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          Propose
        </button>
        <button onClick={() => onBuy(agent)} disabled={isActing} title="Buy / call this agent via Nevermined"
          className="flex-1 flex items-center justify-center gap-1 rounded-lg bg-blue-600 px-2 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-50 transition-colors">
          {actingId === agent.id && actionResult?.type === "buy" ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShoppingCart className="h-3 w-3" />}
          Buy
        </button>
      </div>
      {result && (
        <div className={`flex items-center gap-1.5 text-xs ${result.success ? "text-green-400" : "text-red-400"}`}>
          {result.success ? <CheckCircle className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
          {result.msg}
        </div>
      )}
    </div>
  );
}

// ─── Match Modal ──────────────────────────────────────────────────────────────
function MatchModal({ agent, data, onClose, onPropose, actingId }: {
  agent: Agent; data: MatchResult; onClose: () => void;
  onPropose: (a: Agent) => void; actingId: string | null;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl rounded-2xl border border-[#2a2d3a] bg-[#0f1117] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2d3a]">
          <div className="flex items-center gap-2">
            <Heart className="h-4 w-4 text-pink-400" />
            <h3 className="text-sm font-bold text-white">Matches for {agent.name}</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {data.sponsored_context && data.sponsored_context.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 uppercase tracking-wide flex items-center gap-1">
                <Zap className="h-3 w-3" /> Sponsored
              </p>
              {data.sponsored_context.map((ad, i) => (
                <a key={i} href={ad.url || "#"} target="_blank" rel="noopener noreferrer"
                  className="block rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 hover:border-yellow-500/40 transition-colors">
                  <div className="text-xs font-semibold text-yellow-300">{ad.title || "Sponsored"}</div>
                  {ad.body && <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{ad.body}</p>}
                  {ad.cta && <span className="mt-1 inline-block text-xs text-yellow-400 hover:underline">{ad.cta} →</span>}
                </a>
              ))}
            </div>
          )}
          {data.matches && data.matches.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 uppercase tracking-wide">Complementary Agents</p>
              {data.matches.map(m => (
                <div key={m.id} className="flex items-center justify-between gap-3 rounded-lg border border-[#2a2d3a] bg-[#1a1d27] px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white truncate">{m.name}</div>
                    <div className="text-xs text-slate-500 truncate">{m.team_name} · {m.category}</div>
                    <div className="text-xs text-emerald-400 mt-0.5">{m.pricing}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {m.validation_score != null && (
                      <span className={`text-xs font-bold ${scoreColor(m.validation_score)}`}>{m.validation_score}</span>
                    )}
                    <button onClick={() => { onPropose(m); onClose(); }} disabled={actingId === m.id}
                      className="flex items-center gap-1 rounded-lg bg-purple-600/20 px-3 py-1.5 text-xs text-purple-300 hover:bg-purple-600/30 border border-purple-500/20 transition-colors">
                      <Send className="h-3 w-3" /> Propose
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {data.matches?.length === 0 && data.sponsored_context?.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-4">No matches found for this agent category.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Future Proposal Card ──────────────────────────────────────────────────────
function futureStatusStyle(s: string) {
  if (s === "accepted")    return "bg-green-500/20 text-green-300 border border-green-500/30";
  if (s === "negotiating") return "bg-amber-500/20 text-amber-300 border border-amber-500/30";
  if (s === "building")    return "bg-blue-500/20 text-blue-300 border border-blue-500/30";
  if (s === "delivered")   return "bg-purple-500/20 text-purple-300 border border-purple-500/30";
  if (s === "rejected")    return "bg-red-500/10 text-red-400 border border-red-500/20";
  return "bg-slate-700/50 text-slate-400 border border-slate-600/30";
}

function FutureProposalCard({
  fp, negotiateId, counterPrice, counterTimeline, counterMsg,
  onOpenNegotiate, onCounterPriceChange, onCounterTimelineChange, onCounterMsgChange,
  onSubmitNegotiate, onAccept,
}: {
  fp: FutureProposal;
  negotiateId: string | null;
  counterPrice: string; counterTimeline: string; counterMsg: string;
  onOpenNegotiate: (id: string) => void;
  onCounterPriceChange: (v: string) => void;
  onCounterTimelineChange: (v: string) => void;
  onCounterMsgChange: (v: string) => void;
  onSubmitNegotiate: () => void;
  onAccept: (id: string) => void;
}) {
  const isNegotiating = negotiateId === fp.id;
  return (
    <div className="rounded-xl border border-[#2a2d3a] bg-[#1a1d27] p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-semibold text-white">{fp.title}</h4>
            <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${futureStatusStyle(fp.status)}`}>{fp.status}</span>
          </div>
          {fp.target_agent_id && (
            <p className="text-xs text-slate-500 mt-0.5">To: <span className="font-mono text-slate-400">{fp.target_agent_id.slice(0, 40)}{fp.target_agent_id.length > 40 ? "…" : ""}</span></p>
          )}
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-sm font-bold text-emerald-400">{fp.price_credits} cr</p>
          <p className="text-xs text-slate-500">{fp.timeline_days}d</p>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-slate-400 line-clamp-2">{fp.description}</p>

      {/* Counter offer display */}
      {fp.counter_price != null && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <p className="text-xs text-amber-300 font-medium">Counter Offer Received</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Price: <span className="text-amber-300">{fp.counter_price} cr</span> · Timeline: <span className="text-amber-300">{fp.counter_timeline}d</span>
          </p>
          {fp.negotiation_notes && <p className="text-xs text-slate-500 mt-0.5 italic">"{fp.negotiation_notes}"</p>}
        </div>
      )}

      {/* Deliverables */}
      {fp.deliverables && fp.deliverables.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {fp.deliverables.map((d, i) => (
            <span key={i} className="text-xs bg-[#0f1117] border border-[#2a2d3a] text-slate-400 px-2 py-0.5 rounded-md">{d}</span>
          ))}
        </div>
      )}

      {/* ZeroClick Incentive Context */}
      {fp.zeroclick_context && fp.zeroclick_context.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-amber-400 font-medium flex items-center gap-1">
            <Zap className="h-3 w-3" /> ZeroClick Incentive Context
          </p>
          {fp.zeroclick_context.map((ad, i) => {
            const href = ad.offerUrl || ad.url || "#";
            return (
              <a key={i} href={href} target="_blank" rel="noopener noreferrer"
                className="block rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2 hover:border-yellow-500/40 transition-colors">
                <div className="text-xs font-semibold text-yellow-300">{ad.title || "Sponsored"}</div>
                {ad.description && <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{ad.description}</p>}
              </a>
            );
          })}
        </div>
      )}

      {/* Action buttons */}
      {fp.status !== "accepted" && fp.status !== "delivered" && fp.status !== "rejected" && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => onAccept(fp.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/30 transition-colors"
          >
            <CheckCircle className="h-3 w-3" /> Accept
          </button>
          <button
            onClick={() => onOpenNegotiate(isNegotiating ? "" : fp.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-600/20 text-amber-300 border border-amber-500/30 hover:bg-amber-600/30 transition-colors"
          >
            <ArrowRightLeft className="h-3 w-3" /> {isNegotiating ? "Cancel" : "Negotiate"}
          </button>
        </div>
      )}

      {/* Negotiate form */}
      {isNegotiating && (
        <div className="rounded-lg border border-[#2a2d3a] bg-[#0f1117] p-3 space-y-2">
          <p className="text-xs font-medium text-slate-300">Submit Counter-Offer</p>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-slate-500">Counter Price (cr)</label>
              <input
                type="number" value={counterPrice} onChange={e => onCounterPriceChange(e.target.value)}
                placeholder={String(fp.price_credits)}
                className="w-full mt-1 rounded-lg bg-[#1a1d27] border border-[#2a2d3a] px-2 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-slate-500">Timeline (days)</label>
              <input
                type="number" value={counterTimeline} onChange={e => onCounterTimelineChange(e.target.value)}
                placeholder={String(fp.timeline_days)}
                className="w-full mt-1 rounded-lg bg-[#1a1d27] border border-[#2a2d3a] px-2 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500"
              />
            </div>
          </div>
          <textarea
            value={counterMsg} onChange={e => onCounterMsgChange(e.target.value)}
            placeholder="Notes for counter-offer…"
            rows={2}
            className="w-full rounded-lg bg-[#1a1d27] border border-[#2a2d3a] px-2 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500 resize-none"
          />
          <button
            onClick={onSubmitNegotiate}
            className="w-full py-1.5 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-500 transition-colors"
          >Submit Counter-Offer</button>
        </div>
      )}
    </div>
  );
}

// ─── Create Future Proposal Modal ─────────────────────────────────────────────
function CreateFutureProposalModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    title: "", description: "",
    deliverables: "", timeline_days: 30, price_credits: 100,
    target_agent_id: "", target_endpoint: "",
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const _apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
  const handleSubmit = async () => {
    if (!form.title || !form.description) return;
    setLoading(true); setResult(null);
    try {
      const deliverables = form.deliverables
        .split(",").map(d => d.trim()).filter(Boolean);
      const res = await fetch(`${_apiUrl}/proposals/future`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title, description: form.description,
          deliverables, timeline_days: form.timeline_days,
          price_credits: form.price_credits,
          target_agent_id: form.target_agent_id,
          target_endpoint: form.target_endpoint,
        }),
      });
      if (res.ok) {
        setResult("✅ Future proposal created!");
        setTimeout(() => { onCreated(); onClose(); }, 1200);
      } else {
        setResult("❌ Failed to create proposal");
      }
    } catch (e) {
      setResult(`❌ ${(e as Error).message}`);
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-[#2a2d3a] bg-[#1a1d27] shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[#2a2d3a]">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Clock className="h-4 w-4 text-violet-400" /> New Future Proposal
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">Commit to building future capabilities — ZeroClick context included.</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="text-xs text-slate-400">Title *</label>
            <input
              value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Custom AI Integration for Your Agent"
              className="mt-1 w-full rounded-lg bg-[#0f1117] border border-[#2a2d3a] px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Description *</label>
            <textarea
              value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe what you'll build and why it's valuable…"
              rows={3}
              className="mt-1 w-full rounded-lg bg-[#0f1117] border border-[#2a2d3a] px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500 resize-none"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Deliverables (comma-separated)</label>
            <input
              value={form.deliverables} onChange={e => setForm(f => ({ ...f, deliverables: e.target.value }))}
              placeholder="Working API, Documentation, Tests, ZeroClick integration"
              className="mt-1 w-full rounded-lg bg-[#0f1117] border border-[#2a2d3a] px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-slate-400">Price (credits)</label>
              <input
                type="number" value={form.price_credits}
                onChange={e => setForm(f => ({ ...f, price_credits: Number(e.target.value) }))}
                className="mt-1 w-full rounded-lg bg-[#0f1117] border border-[#2a2d3a] px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-slate-400">Timeline (days)</label>
              <input
                type="number" value={form.timeline_days}
                onChange={e => setForm(f => ({ ...f, timeline_days: Number(e.target.value) }))}
                className="mt-1 w-full rounded-lg bg-[#0f1117] border border-[#2a2d3a] px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400">Target Agent ID <span className="text-slate-600">(optional — leave blank to broadcast)</span></label>
            <input
              value={form.target_agent_id} onChange={e => setForm(f => ({ ...f, target_agent_id: e.target.value }))}
              placeholder="did:nv:… or walletAddress"
              className="mt-1 w-full rounded-lg bg-[#0f1117] border border-[#2a2d3a] px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Target Endpoint <span className="text-slate-600">(optional — for A2A message delivery)</span></label>
            <input
              value={form.target_endpoint} onChange={e => setForm(f => ({ ...f, target_endpoint: e.target.value }))}
              placeholder="https://their-agent.up.railway.app"
              className="mt-1 w-full rounded-lg bg-[#0f1117] border border-[#2a2d3a] px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500"
            />
          </div>
          {result && (
            <p className={`text-xs ${result.startsWith("✅") ? "text-emerald-400" : "text-red-400"}`}>{result}</p>
          )}
          <button
            onClick={handleSubmit} disabled={loading || !form.title || !form.description}
            className="w-full py-2.5 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
            {loading ? "Creating…" : "Create Future Proposal (with ZeroClick context)"}
          </button>
        </div>
      </div>
    </div>
  );
}
