-- ══════════════════════════════════════════════════════════════
-- AgentBazaar v3.1 — ABTS Migration
-- Run in Supabase SQL Editor AFTER v2 + v3 schemas
-- ══════════════════════════════════════════════════════════════

-- ── Add ABTS trust score columns to agents ─────────────────────
ALTER TABLE agents ADD COLUMN IF NOT EXISTS abts_score       NUMERIC(5,2) DEFAULT 0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS abts_tier        TEXT         DEFAULT 'New';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS abts_components  JSONB        DEFAULT '{}';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS interaction_count INTEGER     DEFAULT 0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS rating_sum       NUMERIC(10,2) DEFAULT 0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS rating_count     INTEGER      DEFAULT 0;

-- ── Indexes ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_agents_abts_score ON agents(abts_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_agents_abts_tier  ON agents(abts_tier);

-- ── agent_ratings table (for per-review records) ─────────────────
CREATE TABLE IF NOT EXISTS agent_ratings (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id     UUID REFERENCES agents(id) ON DELETE CASCADE,
    rating       INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    reviewer_id  TEXT,
    comment      TEXT,
    created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_ratings_agent ON agent_ratings(agent_id);
ALTER TABLE agent_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON agent_ratings FOR ALL USING (true) WITH CHECK (true);

-- ── agent_perf_events table (performance metric log) ─────────────
CREATE TABLE IF NOT EXISTS agent_perf_events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id     UUID REFERENCES agents(id) ON DELETE CASCADE,
    event_type   TEXT,
    latency_ms   INTEGER,
    success      BOOLEAN,
    created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_perf_agent ON agent_perf_events(agent_id);
ALTER TABLE agent_perf_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON agent_perf_events FOR ALL USING (true) WITH CHECK (true);

-- ── job_proposals + job_bids + agent_messages ────────────────────
CREATE TABLE IF NOT EXISTS job_proposals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    poster_agent_id TEXT NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT,
    budget_credits  NUMERIC(10,2) DEFAULT 0,
    deadline_days   INTEGER DEFAULT 7,
    status          TEXT DEFAULT 'open',
    winning_bid_id  UUID,
    transaction_id  TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_proposals_status    ON job_proposals(status);
CREATE INDEX IF NOT EXISTS idx_job_proposals_created   ON job_proposals(created_at DESC);
ALTER TABLE job_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON job_proposals FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS job_bids (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id       UUID REFERENCES job_proposals(id) ON DELETE CASCADE,
    bidder_agent_id   TEXT NOT NULL,
    approach          TEXT,
    timeline_days     INTEGER,
    price_credits     NUMERIC(10,2) DEFAULT 0,
    contact_endpoint  TEXT,
    claude_score      INTEGER,
    claude_reasoning  TEXT,
    status            TEXT DEFAULT 'pending',
    created_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_bids_proposal ON job_bids(proposal_id);
ALTER TABLE job_bids ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON job_bids FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS agent_messages (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id   UUID,
    from_agent_id TEXT NOT NULL,
    to_agent_id   TEXT NOT NULL,
    content       TEXT,
    delivered     BOOLEAN DEFAULT false,
    created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_messages_proposal ON agent_messages(proposal_id);
ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON agent_messages FOR ALL USING (true) WITH CHECK (true);

-- ── research_reports table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS research_reports (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic             TEXT NOT NULL,
    depth             TEXT DEFAULT 'brief',
    executive_summary TEXT,
    key_findings      JSONB DEFAULT '[]',
    market_data       JSONB DEFAULT '{}',
    sources           JSONB DEFAULT '[]',
    created_at        TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE research_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON research_reports FOR ALL USING (true) WITH CHECK (true);

-- ── Realtime subscriptions ───────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE job_proposals;
ALTER PUBLICATION supabase_realtime ADD TABLE job_bids;
ALTER PUBLICATION supabase_realtime ADD TABLE agent_messages;
