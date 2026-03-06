import { useState, useEffect, useCallback } from "react";
import {
  ShoppingCart, ArrowRightLeft, Loader2, CheckCircle, AlertCircle,
  RefreshCw, Zap, Search, Star, Heart, Send, X,
  TrendingUp, Users, Globe, BarChart3, Cpu, Database, Shield,
  Megaphone, DollarSign, Briefcase, ChevronDown, ChevronUp,
  MessageSquare, Plus, CheckCheck, Clock, Award
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
function badgeStyle(tier?: string | null) {
  switch (tier) {
    case "platinum": return "bg-purple-500/20 text-purple-300 border border-purple-500/40";
    case "gold":     return "bg-yellow-500/20 text-yellow-300 border border-yellow-500/40";
    case "silver":   return "bg-slate-400/20 text-slate-300 border border-slate-400/30";
    case "bronze":   return "bg-orange-500/20 text-orange-300 border border-orange-500/40";
    default:         return "bg-red-500/10 text-red-400 border border-red-500/20";
  }
}
function scoreColor(score?: number | null) {
  if (!score) return "text-slate-500";
  if (score >= 90) return "text-purple-400";
  if (score >= 75) return "text-yellow-400";
  if (score >= 50) return "text-blue-400";
  if (score >= 25) return "text-orange-400";
  return "text-red-400";
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
  const [newTxIds, setNewTxIds]         = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab]       = useState<"directory"|"transactions"|"proposals"|"jobboard">("directory");

  // Job Board state
  const [expandedProposal, setExpandedProposal] = useState<string | null>(null);
  const [proposalBids, setProposalBids]         = useState<Record<string, JobBid[]>>({});
  const [proposalMsgs, setProposalMsgs]         = useState<Record<string, AgentMessage[]>>({});
  const [showPostModal, setShowPostModal]       = useState(false);
  const [bidModal, setBidModal]                 = useState<JobProposal | null>(null);
  const [msgModal, setMsgModal]                 = useState<JobProposal | null>(null);
  const [jobLoading, setJobLoading]             = useState(false);
  const [jobStatusFilter, setJobStatusFilter]   = useState<"open"|"funded"|"all">("open");

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

  const fetchJobProposals = useCallback(async () => {
    setJobLoading(true);
    try {
      const status = jobStatusFilter === "all" ? "all" : jobStatusFilter;
      const res = await fetch(`${API_URL}/proposals?status=${status}&limit=50`);
      if (res.ok) setJobProposals(await res.json());
    } catch { /**/ } finally { setJobLoading(false); }
  }, [jobStatusFilter]);

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
    if (search) {
      const s = search.toLowerCase();
      return (a.name + a.description + (a.team_name || "") + (a.category || "")).toLowerCase().includes(s);
    }
    return true;
  });
  const ourAgents = filtered.filter(a => a.source === "agentbazaar");
  const mktAgents = filtered.filter(a => a.source !== "agentbazaar");

  const openProposals  = jobProposals.filter(p => p.status === "open").length;
  const fundedProposals = jobProposals.filter(p => p.status === "funded").length;

  const tabCounts = {
    directory:    agents.length,
    transactions: transactions.length,
    proposals:    proposals.length,
    jobboard:     jobProposals.length,
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
          <div className="flex gap-2">
            {activeTab === "jobboard" && (
              <button
                onClick={() => setShowPostModal(true)}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" /> Post Job
              </button>
            )}
            <button
              onClick={handleValidateAll} disabled={validating}
              className="flex items-center gap-2 rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-500 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {validating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Validate All
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-[#2a2d3a] overflow-x-auto">
          {([
            { key: "directory",    label: "Directory",     icon: <Globe className="h-3.5 w-3.5" /> },
            { key: "jobboard",     label: "Job Board",     icon: <Briefcase className="h-3.5 w-3.5" /> },
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
                          onBuy={handleBuy} onPropose={handlePropose} onMatch={handleMatch} highlight />
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
                      </div>
                      <button onClick={fetchAgents} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300">
                        <RefreshCw className="h-3 w-3" /> Refresh
                      </button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                      {mktAgents.map(agent => (
                        <AgentCard key={agent.id} agent={agent} actingId={actingId} actionResult={actionResult}
                          onBuy={handleBuy} onPropose={handlePropose} onMatch={handleMatch} />
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
function AgentCard({ agent, actingId, actionResult, onBuy, onPropose, onMatch, highlight }: {
  agent: Agent; actingId: string | null;
  actionResult: { id: string; type: string; success: boolean; msg: string } | null;
  onBuy: (a: Agent) => void; onPropose: (a: Agent) => void; onMatch: (a: Agent) => void;
  highlight?: boolean;
}) {
  const isActing = actingId === agent.id || actingId === agent.id + "-match";
  const result   = actionResult?.id === agent.id ? actionResult : null;
  return (
    <div className={`rounded-xl border flex flex-col gap-3 p-4 transition-colors ${
      highlight ? "border-blue-500/30 bg-gradient-to-br from-[#1a1d27] to-blue-950/20" : "border-[#2a2d3a] bg-[#1a1d27] hover:border-slate-600/50"
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-white leading-tight truncate">{agent.name}</h4>
          {agent.team_name && <p className="text-xs text-slate-500 mt-0.5">{agent.team_name}</p>}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {agent.validation_score != null && (
            <span className={`text-xs font-bold ${scoreColor(agent.validation_score)}`}>{agent.validation_score}/100</span>
          )}
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${agent.badge_tier ? badgeStyle(agent.badge_tier) : "bg-slate-700/50 text-slate-500"}`}>
            {agent.badge_tier || "unscored"}
          </span>
        </div>
      </div>
      {agent.category && (
        <span className="self-start rounded-full bg-slate-700/50 px-2 py-0.5 text-xs text-slate-400">{agent.category}</span>
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
        <button onClick={() => onBuy(agent)} disabled={isActing} title="Buy / call this agent"
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
                <Megaphone className="h-3 w-3" /> Sponsored
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
