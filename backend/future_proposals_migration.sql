-- Future Proposals Migration
-- Run this in Supabase SQL Editor after supabase_schema.sql and abts_migration.sql

CREATE TABLE IF NOT EXISTS future_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  deliverables JSONB DEFAULT '[]',
  timeline_days INT DEFAULT 30,
  price_credits FLOAT DEFAULT 100.0,
  status TEXT DEFAULT 'proposed',
  -- status values: proposed | negotiating | accepted | building | delivered | rejected
  proposer_agent_id TEXT DEFAULT 'AgentBazaar',
  target_agent_id TEXT DEFAULT '',
  target_endpoint TEXT DEFAULT '',
  counter_price FLOAT,
  counter_timeline INT,
  negotiation_notes TEXT,
  zeroclick_context JSONB DEFAULT '[]',
  social_context JSONB DEFAULT '{}',
  contacted_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fp_status ON future_proposals(status);
CREATE INDEX IF NOT EXISTS idx_fp_target ON future_proposals(target_agent_id);
CREATE INDEX IF NOT EXISTS idx_fp_created ON future_proposals(created_at DESC);
