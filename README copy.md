# AgentBazaar — AI Agent Capability Validator

An AI agent marketplace starting with a **Capability Validator**: submit any AI agent, and the system scrapes its URL, searches for comparable agents, scores it with Claude, and returns a structured scorecard — all gated behind Nevermined x402 payments.

**Tech stack:** FastAPI · Nevermined x402 · Apify MCP · Exa · Claude (`claude-sonnet-4-6`) · Supabase · React + Vite + Tailwind

---

## Architecture

```
POST /validate
  └─► Nevermined PaymentMiddleware (x402 gate — 402 if no valid token)
       └─► asyncio.gather(
             Apify MCP rag-web-browser (scrape agent URL),
             Exa semantic search (find similar agents)
           )
            └─► Claude claude-sonnet-4-6 (score → JSON scorecard)
                 └─► Supabase INSERT (triggers realtime dashboard update)
                      └─► JSON response to caller
```

---

## Step 1 — Get API keys

| Service | Sign up | Key |
|---|---|---|
| Nevermined | [nevermined.app](https://nevermined.app) → Settings → API Keys | `NVM_API_KEY` |
| Apify | [apify.com](https://apify.com) → Settings → Integrations | `APIFY_TOKEN` |
| Exa | [dashboard.exa.ai](https://dashboard.exa.ai) | `EXA_API_KEY` |
| Anthropic | [console.anthropic.com](https://console.anthropic.com) | `ANTHROPIC_API_KEY` |
| Supabase | [supabase.com](https://supabase.com) → New Project | `SUPABASE_URL` + `SUPABASE_KEY` |

---

## Step 2 — Supabase setup

In your Supabase project, open the **SQL Editor** and run:

```sql
CREATE TABLE validation_results (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    agent_name      TEXT NOT NULL,
    capability      TEXT,
    url             TEXT,
    overall_score   INTEGER NOT NULL,
    dimension_scores JSONB,
    risk_flags      JSONB DEFAULT '[]'::jsonb,
    badge           TEXT,
    summary         TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_vr_score ON validation_results(overall_score DESC);
CREATE INDEX idx_vr_created ON validation_results(created_at DESC);

-- Required for the dashboard live feed
ALTER PUBLICATION supabase_realtime ADD TABLE validation_results;
```

---

## Step 3 — Backend local setup

```bash
cd backend
cp .env.example .env
# Fill in all values in .env

pip install -r requirements.txt

# Test it works (payment gate disabled until NVM_PLAN_ID is set)
uvicorn main:app --reload --port 8000
curl http://localhost:8000/healthz
# → {"status":"ok"}
```

---

## Step 4 — Register Nevermined agent (one-time)

```bash
cd backend

# Make sure .env has NVM_API_KEY, NVM_ENVIRONMENT=sandbox
# Optionally set BACKEND_URL to your Railway URL (or leave as placeholder)
python register_agent.py
```

This prints:
```
✅ Registration successful!
  NVM_PLAN_ID=did:nv:abc123...
  NVM_AGENT_ID=did:nv:xyz789...
```

Add these two values to your `.env` (and later to Railway Variables).

---

## Step 5 — Test the full pipeline

With `NVM_PLAN_ID` set in `.env`, the payment gate is active. To test without paying:

**Option A — Temporarily disable the gate** (comment out the `if NVM_PLAN_ID:` block in `main.py`), then:

```bash
curl -X POST http://localhost:8000/validate \
  -H "Content-Type: application/json" \
  -d '{"agent_name":"TestBot","capability":"web research and summarization","url":"https://example.com"}'
```

**Option B — Full x402 flow** (subscriber side):

```python
from payments_py import Payments, PaymentOptions
import requests, os

sub = Payments.get_instance(
    PaymentOptions(nvm_api_key=os.environ["SUBSCRIBER_NVM_KEY"], environment="sandbox")
)
sub.plans.order_plan("YOUR_NVM_PLAN_ID")
token = sub.x402.get_x402_access_token("YOUR_NVM_PLAN_ID", "YOUR_NVM_AGENT_ID")

resp = requests.post(
    "http://localhost:8000/validate",
    headers={"payment-signature": token["accessToken"], "Content-Type": "application/json"},
    json={"agent_name": "TestBot", "capability": "web research", "url": "https://example.com"},
)
print(resp.json())
```

---

## Step 6 — Deploy backend to Railway

```bash
# Install Railway CLI
npm install -g @railway/cli
railway login

cd backend
railway init
railway up

# Get your public URL
railway domain

# Set env vars in Railway dashboard → your service → Variables tab
# (add all values from .env, including NVM_PLAN_ID after registration)
```

---

## Step 7 — Frontend setup

```bash
cd frontend
cp .env.example .env
# Set VITE_API_URL to your Railway URL
# Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

npm install
npm run dev
# → http://localhost:5173
```

**Pages:**
- `/` — Live dashboard with stat cards + realtime validation feed
- `/leaderboard` — Sortable/filterable leaderboard table
- `/submit` — Form to submit an agent for validation

---

## Step 8 — Deploy frontend to Vercel

```bash
cd frontend
npm run build

# Via Vercel CLI
npm install -g vercel
vercel

# Set env vars in Vercel dashboard → Settings → Environment Variables
# VITE_API_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
```

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `POST` | `/validate` | Validate an agent (x402 payment-gated) |
| `GET` | `/leaderboard` | Top agents by score (`?limit=20`) |
| `GET` | `/feed` | Most recent validations (`?limit=50`) |
| `GET` | `/stats` | Aggregate stats for dashboard cards |
| `GET` | `/healthz` | Health check |
| `GET` | `/openapi.json` | Auto-generated OpenAPI schema |

### POST /validate — request body
```json
{
  "agent_name": "ResearchBot",
  "capability": "Autonomous web research and summarization",
  "url": "https://your-agent.com"
}
```

### POST /validate — response
```json
{
  "id": "uuid",
  "agent_name": "ResearchBot",
  "overall_score": 82,
  "dimension_scores": {
    "autonomy": 85, "reasoning": 80, "tool_use": 90, "safety": 75, "reliability": 80
  },
  "risk_flags": ["high_autonomy"],
  "badge": "gold",
  "summary": "ResearchBot demonstrates strong tool use and autonomy. Minor safety concerns around output filtering."
}
```

---

## Scorecard badge tiers

| Badge | Score | Color |
|---|---|---|
| Platinum | 90–100 | Purple |
| Gold | 75–89 | Yellow |
| Silver | 50–74 | Gray |
| Bronze | 25–49 | Orange |
| Needs Work | 0–24 | Red |

---

## Future: AgentBazaar Marketplace

The validator is Phase 1. Planned extensions:
- **Agent discovery**: browse/search all registered Nevermined agents
- **A2A payments**: agent-to-agent payment flows via `PaymentsA2AServer`
- **Score history**: per-agent detail pages with score trends
- **Capability filtering**: search by badge, risk level, or capability category
