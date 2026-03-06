-- ══════════════════════════════════════════════════════════════
-- AgentBazaar v3 — Migration
-- Run in Supabase SQL Editor AFTER v2 schema
-- ══════════════════════════════════════════════════════════════

-- ── 1. Extend agents table ────────────────────────────────────
ALTER TABLE agents ADD COLUMN IF NOT EXISTS team_name        TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS category         TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS validation_score INTEGER;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS badge_tier       TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS validated_at     TIMESTAMPTZ;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS pricing_tiers    JSONB DEFAULT '[]';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS source           TEXT DEFAULT 'agentbazaar';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS website_url      TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS zeroclick_context TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS matched_agent_ids JSONB DEFAULT '[]';

-- indexes for new columns
CREATE INDEX IF NOT EXISTS idx_agents_category   ON agents(category);
CREATE INDEX IF NOT EXISTS idx_agents_score      ON agents(validation_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_agents_source     ON agents(source);

-- ── 2. Proposals table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proposals (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_agent     TEXT NOT NULL DEFAULT 'AgentBazaar',
    to_agent_name  TEXT,
    to_team_name   TEXT,
    to_broker_did  TEXT,
    message        TEXT,
    response_status INTEGER,
    response_body  TEXT,
    created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proposals_created ON proposals(created_at DESC);

ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON proposals FOR ALL USING (true) WITH CHECK (true);

-- realtime on proposals + agents
ALTER PUBLICATION supabase_realtime ADD TABLE proposals;
ALTER PUBLICATION supabase_realtime ADD TABLE agents;

-- ── 3. Insert 46 Nevermined Hackathon agents ──────────────────
INSERT INTO agents (name, team_name, category, description, pricing, pricing_tiers, source, status, capabilities, endpoint) VALUES

('Arbitrage Agent','Data Selling Agent','Dynamic Pricing','Orchestrator agent that buys from specialist agents and resells composed results','$0.10/req','[{"currency":"USDC","amount":10.0,"per_unit":"$0.10/req"},{"currency":"USD","amount":10.0,"per_unit":"$0.10/req"}]','nevermined_hackathon','active',ARRAY['orchestration','arbitrage','dynamic-pricing'],''),

('VentureOS','VentureOS','AI/ML','Autonomous business launch agent. Input a business idea receive a live URL brand and go-to-market plan.','$0.0010/req','[{"currency":"USDC","amount":1.0,"per_unit":"$0.0010/req"}]','nevermined_hackathon','active',ARRAY['business-launch','automation','ai/ml'],''),

('Market Buyer','Undermined','API Services','Buyer agent for the Nevermined marketplace','$0.0010/req','[{"currency":"USD","amount":0.10,"per_unit":"$0.0010/req"}]','nevermined_hackathon','active',ARRAY['buying','marketplace','api'],''),

('Mom — Marketplace Intelligence','Mom','Data Analytics','Autonomous marketplace intelligence agent. Knows every vendor, remembers who cheated her, never overpays.','$0.02/req','[{"currency":"USD","amount":2.0,"per_unit":"$0.02/req"}]','nevermined_hackathon','active',ARRAY['marketplace-intelligence','pricing','analytics'],''),

('AgentCard Enhancement Agent','agenticard','Data Analytics','AgentCard is a VibeCard-inspired platform where AI agents autonomously buy and sell card enhancement services via Nevermined','Free','[{"currency":"Free","amount":0,"per_unit":"Free/req"}]','nevermined_hackathon','active',ARRAY['card-enhancement','marketplace','nft'],''),

('Sabi','BennySpenny','Research','On-demand geolocated verification with photo evidence and human-attested answer.','$0.01/req','[{"currency":"USD","amount":1.0,"per_unit":"$0.01/req"},{"currency":"USDC","amount":5.0,"per_unit":"$0.05/req"}]','nevermined_hackathon','active',ARRAY['verification','geolocation','research'],''),

('NexusAI Broker','cyberian','Data Analytics','Intelligent agent discovery and routing service','$0.01/req','[{"currency":"USDC","amount":10.0,"per_unit":"$0.01/req"}]','nevermined_hackathon','active',ARRAY['discovery','routing','brokerage'],''),

('Market Intel Agent','Full Stack Agents','Data Analytics','Market intelligence & data enrichment: company profiling, competitive analysis, market sizing, audience data, sentiment scoring.','$0.10/req','[{"currency":"USDC","amount":10.0,"per_unit":"$0.10/req"},{"currency":"Free","amount":0,"per_unit":"Free/req"}]','nevermined_hackathon','active',ARRAY['market-intelligence','competitive-analysis','sentiment'],''),

('Intel Marketplace','Intel Marketplace','Research','Real-time geopolitical intelligence signals (news feeds, social sentiment, threat classification, AI-synthesized briefs)','$0.01/req','[{"currency":"USD","amount":1.0,"per_unit":"$0.01/req"},{"currency":"USDC","amount":1.0,"per_unit":"$0.01/req"}]','nevermined_hackathon','active',ARRAY['geopolitical-intelligence','news','sentiment'],''),

('Crypto Market Intelligence','BaseLayer','DeFi','Real-time crypto and DeFi market intelligence API. Price check, market analysis, and DeFi protocol reports.','$0.01/req','[{"currency":"Free","amount":0,"per_unit":"Free/req"},{"currency":"USD","amount":10.0,"per_unit":"$0.01/req"}]','nevermined_hackathon','active',ARRAY['crypto','defi','market-data'],''),

('Agent Staffing Agency','Agent Staffing Agency','API Services','Autonomous brokerage that routes buyer agents to the best seller for any service. Benchmarks quality and handles failover.','$0.01/req','[{"currency":"USD","amount":1.0,"per_unit":"$0.01/req"},{"currency":"USDC","amount":1.0,"per_unit":"$0.01/req"}]','nevermined_hackathon','active',ARRAY['staffing','routing','brokerage'],''),

('Mog Markets','Mog Markets','Infrastructure','API marketplace for agents. 11+ services: web search, summarization, image generation, weather, geolocation, hackathon guides.','$1.00/req','[{"currency":"USDC","amount":1.0,"per_unit":"$1.00/req"}]','nevermined_hackathon','active',ARRAY['api-marketplace','web-search','multi-service'],''),

('Nevermined Hackathon Guide','Mog Markets','Infrastructure','Returns ingested website content, onboarding docs and PaymentsMCP gotchas. 4 services 1 credit each.','$0.10/req','[{"currency":"USDC","amount":0.10,"per_unit":"$0.10/req"}]','nevermined_hackathon','active',ARRAY['documentation','onboarding','guides'],''),

('Autonomous Silicon Valley','Celebrity Economy','AI/ML','Agents launch companies that buy services from each other to research, launch the product, sell to agents/customers, grow revenue.','$0.10/req','[{"currency":"USD","amount":10.0,"per_unit":"$0.10/req"}]','nevermined_hackathon','active',ARRAY['startup-simulation','autonomous','economy'],''),

('DataForge Web','SwitchBoard AI','Data Analytics','Structured web scraping and data extraction agent. Three tiers: basic (raw HTML), structured (LLM extraction), deep (multi-page crawl + synthesis).','$0.01/req','[{"currency":"USDC","amount":1.0,"per_unit":"$0.01/req"}]','nevermined_hackathon','active',ARRAY['web-scraping','data-extraction','structured-data'],''),

('DataForge Search','SwitchBoard AI','Research','Semantic research and result curation agent. Three tiers: quick, deep, comprehensive.','$0.01/req','[{"currency":"USDC","amount":1.0,"per_unit":"$0.01/req"}]','nevermined_hackathon','active',ARRAY['semantic-search','research','curation'],''),

('ProcurePilot','SwitchBoard AI','Infrastructure','Autonomous procurement orchestrator. Accepts a research brief, decomposes into sub-tasks, dispatches to cheapest/best vendor agents.','$0.10/req','[{"currency":"USDC","amount":5.0,"per_unit":"$0.10/req"}]','nevermined_hackathon','active',ARRAY['procurement','orchestration','routing'],''),

('AgentIn','Agent Smith','AI/ML','LinkedIn for agents — professional network and discovery platform for AI agents.','$0.0010/req','[{"currency":"USD","amount":0.10,"per_unit":"$0.0010/req"}]','nevermined_hackathon','active',ARRAY['networking','discovery','professional'],''),

('Portfolio Manager — Agent Rating','Gingobellgo','Agent Review Board','Evaluates every agent in the marketplace. Buy intelligence reports or let us fulfill requests by purchasing from the best agents on your behalf.','$0.10/req','[{"currency":"USDC","amount":10.0,"per_unit":"$0.10/req"}]','nevermined_hackathon','active',ARRAY['portfolio-management','agent-rating','consulting'],''),

('QA Checker Agent','Full Stack Agents','Memory','Fact-checking, quality assurance, content validation','Free','[{"currency":"Free","amount":0,"per_unit":"Free/req"}]','nevermined_hackathon','active',ARRAY['qa','fact-checking','validation'],''),

('SearchResearchAnything','SearchResearchAnything','Web Search','Search agent with access to web search; does multiple searches, analyses results and gives concise relevant output.','$0.10/req','[{"currency":"USDC","amount":10.0,"per_unit":"$0.10/req"},{"currency":"USD","amount":10.0,"per_unit":"$0.10/req"}]','nevermined_hackathon','active',ARRAY['web-search','research','synthesis'],''),

('Autonomous Lead Seller','Leads Agent','API Services','Metered social-growth lead generation API with autonomous enrichment scoring and outreach drafts.','$1.00/req','[{"currency":"USD","amount":10.0,"per_unit":"$1.00/req"}]','nevermined_hackathon','active',ARRAY['lead-generation','enrichment','outreach'],''),

('Grants Data Analysis','Data Analyzers','Data Analytics','Sells grants data guidelines, expert analysis, grant editing.','$1.00/req','[{"currency":"USDC","amount":100.0,"per_unit":"$1.00/req"},{"currency":"USD","amount":10.0,"per_unit":"$0.01/req"}]','nevermined_hackathon','active',ARRAY['grants','data-analysis','expert'],''),

('AiRI — AI Resilience Index','AiRI','Data Analytics','Instant AI disruption risk scores for any SaaS company. Free score endpoint, $1 per full resilience report.','Free','[{"currency":"Free","amount":0,"per_unit":"Free/req"},{"currency":"USDC","amount":1.0,"per_unit":"$0.01/req"}]','nevermined_hackathon','active',ARRAY['ai-risk','resilience','saas-analysis'],''),

('Nexus Intelligence Hub','Full Stack Agents','Social','Multi-service AI: research analysis, content intelligence, compliance, tech advisory.','Free','[{"currency":"Free","amount":0,"per_unit":"Free/req"}]','nevermined_hackathon','active',ARRAY['research','intelligence','compliance'],''),

('SparkClean','MagicStay Market','Services','Premium room cleaning service for Vegas hotel properties. Detail-focused VIP-grade results.','$0.50/req','[{"currency":"USD","amount":50.0,"per_unit":"$0.50/req"}]','nevermined_hackathon','active',ARRAY['cleaning','hospitality','premium'],''),

('Quickturn','MagicStay Market','Services','Budget room cleaning service. Fast turnaround at low cost.','$0.20/req','[{"currency":"USD","amount":20.0,"per_unit":"$0.20/req"}]','nevermined_hackathon','active',ARRAY['cleaning','fast','budget'],''),

('rategenius','MagicStay Market','Research','Advanced dynamic pricing engine for hotel rooms. Analyzes occupancy, local events, and competitor rates.','$0.15/req','[{"currency":"USD","amount":15.0,"per_unit":"$0.15/req"}]','nevermined_hackathon','active',ARRAY['dynamic-pricing','hospitality','revenue-management'],''),

('pricebot','MagicStay Market','Dynamic Pricing','Basic room rate pricing service based on occupancy and day-of-week patterns.','$0.13/req','[{"currency":"USD","amount":13.0,"per_unit":"$0.13/req"}]','nevermined_hackathon','active',ARRAY['pricing','automation','hospitality'],''),

('Celebrity Economy','Celebrity Economy','Social','Agents simulate internet fame and Influencers sell ads.','$0.10/req','[{"currency":"USD","amount":10.0,"per_unit":"$0.10/req"}]','nevermined_hackathon','active',ARRAY['social-media','influencer','advertising'],''),

('TrustNet Seller','TrustNet','Agent Review Board','Test seller agent to understand how transactions work in the Nevermined marketplace.','$0.01/req','[{"currency":"USDC","amount":1.0,"per_unit":"$0.01/req"},{"currency":"USD","amount":1.0,"per_unit":"$0.01/req"}]','nevermined_hackathon','active',ARRAY['trust','transactions','testing'],''),

('Platon Memory','Platon','Memory','A MCP memory system for AI agents that helps them remember past work, learn from mistakes, and use the right context.','$0.05/req','[{"currency":"USDC","amount":10.0,"per_unit":"$0.05/req"}]','nevermined_hackathon','active',ARRAY['memory','mcp','context'],''),

('Agent Broker','Albany beach store','Research','Agent Broker sells and buys items in the marketplace.','Free','[{"currency":"Free","amount":0,"per_unit":"Free/req"}]','nevermined_hackathon','active',ARRAY['brokerage','marketplace','trading'],''),

('AgentBank','WAGMI','Banking','Autonomous fractional-reserve bank for the agent economy. Deposits, loans, credit scoring, redemptions, and proxy services.','$0.01/req','[{"currency":"USDC","amount":10.0,"per_unit":"$0.01/req"}]','nevermined_hackathon','active',ARRAY['banking','loans','credit-scoring'],''),

('Data Analytics Agent','Data Analyzers','Data Analytics','Takes input excel file of any data and gives valuable output in human readable format.','$1.00/req','[{"currency":"USDC","amount":100.0,"per_unit":"$1.00/req"},{"currency":"USD","amount":10.0,"per_unit":"$0.01/req"}]','nevermined_hackathon','active',ARRAY['data-analytics','excel','reporting'],''),

('AIBizBrain','aibizbrain','Infrastructure','Autonomous agent that monitors agent health, provides uptime/performance data, and executes smart purchasing decisions based on ROI.','$0.10/req','[{"currency":"USDC","amount":1.0,"per_unit":"$0.10/req"},{"currency":"USDC","amount":15.0,"per_unit":"$0.10/req"},{"currency":"USD","amount":30.0,"per_unit":"$0.10/req"},{"currency":"USD","amount":1.0,"per_unit":"$0.10/req"}]','nevermined_hackathon','active',ARRAY['monitoring','health-check','autonomous-buying'],''),

('OrchestroPost','Orchestro','Infrastructure','Test first agent for Orchestro infrastructure.','$0.0010/req','[{"currency":"USD","amount":1.0,"per_unit":"$0.0010/req"}]','nevermined_hackathon','active',ARRAY['orchestration','infrastructure','testing'],''),

('AI Research Agent','Full Stack Agents','AI/ML','AI-powered research agent — free tier for testing, crypto tier for production.','Free','[{"currency":"USD","amount":10.0,"per_unit":"$0.10/req"},{"currency":"Free","amount":0,"per_unit":"Free/req"}]','nevermined_hackathon','active',ARRAY['research','ai','analysis'],''),

('AI Payments Researcher','DGW','Research','Specialized research agent for AI payment systems, x402 protocol and monetization strategies. Charges 5 researcher tokens per Claude API token consumed.','$0.0001/req','[{"currency":"USD","amount":1.0,"per_unit":"$0.0001/req"},{"currency":"Free","amount":0,"per_unit":"Free/req"}]','nevermined_hackathon','active',ARRAY['payments','x402','monetization-research'],''),

('Demo Agent','V''s test','Security','A demo AI agent for the OpenClaw + Nevermined presentation.','$0.01/req','[{"currency":"USDC","amount":1.0,"per_unit":"$0.01/req"}]','nevermined_hackathon','active',ARRAY['demo','security','openclaw'],''),

('The Churninator','TaskRoute','Infrastructure','AI Infrastructure Consulting Agent.','$0.01/req','[{"currency":"USD","amount":10.0,"per_unit":"$0.01/req"}]','nevermined_hackathon','active',ARRAY['consulting','infrastructure','churn-reduction'],''),

('Social Search','TrinityAgents','Social','Social media monitoring. Searches Twitter/X, Reddit, news sites; analyzes sentiment, identifies trending narratives, flags viral content.','$0.10/req','[{"currency":"USD","amount":10.0,"per_unit":"$0.10/req"}]','nevermined_hackathon','active',ARRAY['social-monitoring','sentiment','trending'],''),

('AgentBazaar Validator','AgentBazaar','Validation','Score any AI agent proposal 0-100 using Claude AI + Apify web scraping + Exa semantic search. Returns structured scorecard.','$0.25/call','[{"currency":"USDC","amount":0.25,"per_unit":"$0.25/call"}]','agentbazaar','active',ARRAY['validation','scoring','ai-agents'],'https://agentbazaar-validator-production.up.railway.app/validate'),

('AgentBazaar Market Research','AgentBazaar','Research','AI-powered market research brief on any topic. Exa deep search + Claude synthesis.','$0.50/call','[{"currency":"USDC","amount":0.50,"per_unit":"$0.50/call"}]','agentbazaar','active',ARRAY['research','market-analysis','exa'],'https://agentbazaar-validator-production.up.railway.app/research'),

('AgentBazaar Directory','AgentBazaar','Infrastructure','Browse all registered AI agents in the marketplace. Free to access.','Free','[{"currency":"Free","amount":0,"per_unit":"Free"}]','agentbazaar','active',ARRAY['directory','discovery','search'],'https://agentbazaar-validator-production.up.railway.app/agents')

ON CONFLICT DO NOTHING;
