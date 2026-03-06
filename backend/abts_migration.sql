-- ══════════════════════════════════════════════════════════════
-- AgentBazaar ABTS Migration
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query → paste → Run)
-- Safe to run multiple times (IF NOT EXISTS / DO NOTHING pattern)
-- ══════════════════════════════════════════════════════════════

-- ── 1. Extend agents table with all v3 columns ────────────────
-- These may already exist from previous runs — each is added only if missing

ALTER TABLE agents ADD COLUMN IF NOT EXISTS team_name       TEXT DEFAULT '';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS category        TEXT DEFAULT 'AI/ML';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS source          TEXT DEFAULT 'agentbazaar';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS website_url     TEXT DEFAULT '';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS validation_score INTEGER;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS badge_tier      TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS validated_at    TIMESTAMPTZ;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS zeroclick_context TEXT;

-- ── 2. ABTS (Agent Bazaar Trust Score) columns ────────────────
ALTER TABLE agents ADD COLUMN IF NOT EXISTS abts_score        FLOAT DEFAULT 0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS abts_tier         TEXT DEFAULT 'New';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS abts_components   JSONB DEFAULT '{}';

-- ── 3. ABTS input metrics ────────────────────────────────────
ALTER TABLE agents ADD COLUMN IF NOT EXISTS interaction_count INTEGER DEFAULT 0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS rating_sum        FLOAT DEFAULT 0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS rating_count      INTEGER DEFAULT 0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS uptime_pct        FLOAT DEFAULT 100;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS completion_rate   FLOAT DEFAULT 100;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS error_rate        FLOAT DEFAULT 0;

-- ── 4. Indexes for ABTS queries ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_agents_abts      ON agents(abts_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_agents_tier      ON agents(abts_tier);
CREATE INDEX IF NOT EXISTS idx_agents_source    ON agents(source);
CREATE INDEX IF NOT EXISTS idx_agents_category  ON agents(category);
CREATE INDEX IF NOT EXISTS idx_agents_vscore    ON agents(validation_score DESC NULLS LAST);

-- ── 5. Agent ratings table (for reputation pillar R) ─────────
CREATE TABLE IF NOT EXISTS agent_ratings (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id   UUID REFERENCES agents(id) ON DELETE CASCADE,
    rater_id   TEXT NOT NULL DEFAULT 'anonymous',
    rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment    TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ar_agent ON agent_ratings(agent_id);
CREATE INDEX IF NOT EXISTS idx_ar_rater ON agent_ratings(rater_id);

ALTER TABLE agent_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON agent_ratings FOR ALL USING (true) WITH CHECK (true);

-- Realtime for live rating updates
ALTER PUBLICATION supabase_realtime ADD TABLE agent_ratings;

-- ── 6. Agent performance events (for P pillar) ───────────────
CREATE TABLE IF NOT EXISTS agent_perf_events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id      UUID REFERENCES agents(id) ON DELETE CASCADE,
    event_type    TEXT NOT NULL CHECK (event_type IN ('call','error','timeout','success')),
    latency_ms    INTEGER DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ape_agent ON agent_perf_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_ape_type  ON agent_perf_events(event_type);
CREATE INDEX IF NOT EXISTS idx_ape_time  ON agent_perf_events(created_at DESC);

ALTER TABLE agent_perf_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON agent_perf_events FOR ALL USING (true) WITH CHECK (true);

-- ── 7. Backfill existing agents with initial ABTS scores ─────
-- Sets all existing agents to "New" tier with score 10 (cold start)
-- Actual ABTS will be recalculated by the backend _recalc_abts_all() task
UPDATE agents
SET
    abts_score   = COALESCE(validation_score::float * 0.15 * 0.1, 5),
    abts_tier    = CASE
                     WHEN validation_score IS NULL THEN 'New'
                     WHEN validation_score >= 80    THEN 'Verified'
                     ELSE 'New'
                   END,
    abts_components = '{"R":70,"P":100,"V":50,"S":10,"c_conf":0.1}'::jsonb
WHERE abts_score = 0 OR abts_score IS NULL;
