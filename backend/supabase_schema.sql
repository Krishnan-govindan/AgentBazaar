-- ══════════════════════════════════════════════════════════════
-- AgentBazaar v2 — Supabase Schema
-- Run this ONCE in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run)
-- ══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── 1. Validation Results (already exists — keep as-is) ───────
-- If you already ran the v1 schema, this table exists.
-- Only run the CREATE TABLE if it doesn't exist yet.
CREATE TABLE IF NOT EXISTS validation_results (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name       TEXT NOT NULL,
    capability       TEXT,
    url              TEXT,
    overall_score    INTEGER NOT NULL,
    dimension_scores JSONB,
    risk_flags       JSONB DEFAULT '[]'::jsonb,
    badge            TEXT,
    summary          TEXT,
    created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vr_score   ON validation_results(overall_score DESC);
CREATE INDEX IF NOT EXISTS idx_vr_created ON validation_results(created_at DESC);

-- ── 2. Agent Directory ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agents (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    capabilities TEXT[] DEFAULT '{}',
    pricing      TEXT DEFAULT 'free',
    endpoint     TEXT DEFAULT '',
    plan_did     TEXT,
    status       TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending')),
    metadata     JSONB DEFAULT '{}',
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);

-- ── 3. Service Call Logs ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS service_calls (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_name     TEXT NOT NULL,
    caller_agent_id  TEXT,
    request_payload  JSONB DEFAULT '{}',
    response_summary TEXT DEFAULT '',
    credits_used     INTEGER DEFAULT 1,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sc_service ON service_calls(service_name);
CREATE INDEX IF NOT EXISTS idx_sc_created ON service_calls(created_at DESC);

-- ── 4. Research Reports Cache ─────────────────────────────────
CREATE TABLE IF NOT EXISTS research_reports (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic             TEXT NOT NULL,
    depth             TEXT DEFAULT 'brief',
    executive_summary TEXT,
    key_findings      TEXT[],
    market_data       JSONB DEFAULT '{}',
    sources           JSONB DEFAULT '[]',
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rr_topic ON research_reports(topic);

-- ── 5. Cross-Team Agent Purchases ────────────────────────────
-- This is the prize-evidence table for "Most Interconnected Agents"
CREATE TABLE IF NOT EXISTS agent_purchases (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_agent_id    TEXT,      -- which of our agents/bots initiated
    to_agent_id      TEXT,      -- the other team's agent DID / broker ID
    message_sent     TEXT,
    response_status  INTEGER,
    response_body    TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ap_created ON agent_purchases(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ap_to      ON agent_purchases(to_agent_id);

-- ── 6. Row Level Security (open for hackathon) ────────────────
ALTER TABLE agents              ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_calls       ENABLE ROW LEVEL SECURITY;
ALTER TABLE validation_results  ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_reports    ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_purchases     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all" ON agents             FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON service_calls      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON validation_results FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON research_reports   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON agent_purchases    FOR ALL USING (true) WITH CHECK (true);

-- ── 7. Enable Realtime ───────────────────────────────────────
-- Run each line individually if ALTER PUBLICATION errors on existing tables
ALTER PUBLICATION supabase_realtime ADD TABLE validation_results;
ALTER PUBLICATION supabase_realtime ADD TABLE service_calls;
ALTER PUBLICATION supabase_realtime ADD TABLE agent_purchases;

-- ── 8. Seed: AgentBazaar's own 3 services in the directory ───
INSERT INTO agents (name, description, capabilities, pricing, endpoint, status)
VALUES
    (
        'Agent Validator',
        'Score any AI agent proposal 0-100 using Claude AI + Apify web scraping + Exa semantic search. Returns structured scorecard with badge, dimension scores, risk flags, and ZeroClick sponsored insights.',
        ARRAY['validation', 'scoring', 'ai-agents', 'apify', 'exa', 'claude'],
        '$0.25/call',
        '/validate',
        'active'
    ),
    (
        'Market Research',
        'Instant AI-powered market research brief on any topic. Exa deep search (3 query variations) + Claude synthesis. Returns executive summary, key findings, market data, sources, and ZeroClick sponsored context.',
        ARRAY['research', 'market-analysis', 'trend-detection', 'competitive-intel'],
        '$0.50/call',
        '/research',
        'active'
    ),
    (
        'Agent Directory',
        'Browse all registered AI agents in the AgentBazaar marketplace. Returns names, capabilities, pricing, and endpoints. Free to access.',
        ARRAY['directory', 'discovery', 'search', 'marketplace'],
        'Free',
        '/agents',
        'active'
    )
ON CONFLICT DO NOTHING;
