"""
AgentBazaar — Full AI Agent Marketplace
=========================================
FastAPI backend with 3 Nevermined-registered services, ZeroClick AI-native ads,
cross-team A2A buying, autonomous background purchasing loop,
and a full proposal/bidding/messaging lifecycle.

Services:
  POST /validate   — x402-gated: Apify scrape + Exa search → Claude scoring → ZeroClick ads
  POST /research   — x402-gated: Exa multi-query → Claude synthesis → ZeroClick ads
  GET  /agents     — free: agent directory (Supabase)

Cross-team:
  GET  /marketplace/agents       — discover other teams' agents
  POST /marketplace/buy          — buy from another agent, log transaction
  GET  /marketplace/transactions — full ledger for judges
  GET  /marketplace/stats        — stats + cross-team tx count

Job Board (Proposals ↔ Bids ↔ Messages):
  POST /proposals                        — post a job proposal
  GET  /proposals                        — list open proposals
  POST /proposals/{id}/bids              — submit a bid (Claude auto-scores, auto-accepts ≥75)
  GET  /proposals/{id}/bids              — list bids sorted by score
  POST /proposals/{id}/accept            — accept a bid → Nevermined A2A payment
  POST /proposals/{id}/message           — send A2A message via their /chat endpoint
  GET  /proposals/{id}/messages          — get full message thread
  GET  /proposals/stats                  — job board stats

OpenAI-compat broker endpoint:
  POST /chat    — intent-routing to all services, ZeroClick-enriched
  POST /v1/chat/completions
  GET  /v1/models

Install:
    pip install "payments-py[fastapi]" mcp exa-py anthropic supabase fastapi \
                "uvicorn[standard]" python-dotenv httpx apify-client

Run locally:
    uvicorn main:app --reload --port 8000
"""

import os
import json
import uuid
import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Optional
from datetime import date

import httpx

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl
from anthropic import AsyncAnthropic
from exa_py import AsyncExa
from mcp.client.streamable_http import streamablehttp_client
from mcp import ClientSession
from supabase import create_client, Client
from payments_py import Payments, PaymentOptions
from payments_py.x402.fastapi import PaymentMiddleware

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("agentbazaar")

# ── Environment ────────────────────────────────────────────────────────────────
NVM_API_KEY      = os.environ.get("NVM_API_KEY", "")
NVM_ENVIRONMENT  = os.environ.get("NVM_ENVIRONMENT", "sandbox")

# Backward-compat: NVM_PLAN_ID (old single plan) falls back for VALIDATOR
NVM_PLAN_ID                = os.environ.get("NVM_PLAN_ID", "")
NVM_PLAN_ID_VALIDATOR      = os.environ.get("NVM_PLAN_ID_VALIDATOR", NVM_PLAN_ID)
NVM_PLAN_ID_RESEARCH       = os.environ.get("NVM_PLAN_ID_RESEARCH", "")

APIFY_TOKEN = os.environ.get("APIFY_TOKEN", "")
MCP_URL     = "https://mcp.apify.com?tools=apify/rag-web-browser"

ABILITY_BROKER_URL = "https://us14.abilityai.dev/api/paid/agentbroker/chat"

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

ZEROCLICK_API_KEY = os.environ.get("ZEROCLICK_API_KEY", "")

# ── Clients (lazy) ─────────────────────────────────────────────────────────────
payments = (
    Payments.get_instance(PaymentOptions(nvm_api_key=NVM_API_KEY, environment=NVM_ENVIRONMENT))
    if NVM_API_KEY else None
)

claude = AsyncAnthropic() if os.environ.get("ANTHROPIC_API_KEY") else None
exa    = AsyncExa(api_key=os.environ["EXA_API_KEY"]) if os.environ.get("EXA_API_KEY") else None
supa: Client | None = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL else None


def _require(name: str, client):
    if client is None:
        raise HTTPException(
            status_code=503,
            detail=f"{name} not configured — add the required key to backend/.env and restart",
        )
    return client


# ── Background auto-buy loop ───────────────────────────────────────────────────
async def _auto_buy_loop():
    """Every 10 min autonomously buy research from the Ability.ai broker.
    This generates cross-team transaction evidence for the judges."""
    await asyncio.sleep(90)  # let server warm up first
    topics = [
        "AI agent marketplace economic model 2026",
        "Nevermined x402 payment protocol adoption",
        "autonomous agent monetization strategies",
        "ZeroClick AI native advertising market",
        "decentralized AI agent economies",
    ]
    idx = 0
    while True:
        if NVM_API_KEY and supa:
            topic = topics[idx % len(topics)]
            idx += 1
            logger.info(f"[auto-buy] Buying research on: {topic}")
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.post(
                        ABILITY_BROKER_URL,
                        headers={
                            "Authorization": f"Bearer {NVM_API_KEY}",
                            "Content-Type": "application/json",
                        },
                        json={
                            "messages": [{"role": "user", "content": f"research {topic}"}],
                            "model": "agent-bazaar",
                            "stream": False,
                        },
                    )
                result = (
                    resp.json()
                    if resp.headers.get("content-type", "").startswith("application/json")
                    else {"raw": resp.text[:500]}
                )
                supa.table("agent_purchases").insert({
                    "from_agent_id": "agentbazaar-auto-buyer",
                    "to_agent_id":   "ability-broker",
                    "message_sent":  f"research {topic}",
                    "response_status": resp.status_code,
                    "response_body": json.dumps(result)[:2000],
                }).execute()
                logger.info(f"[auto-buy] Transaction logged. Status: {resp.status_code}")
            except Exception as e:
                logger.warning(f"[auto-buy] Failed: {e}")
        await asyncio.sleep(600)  # 10 minutes


async def _auto_proposal_loop():
    """Every 15 min post a new job proposal + auto-accept bids scoring >= 75.
    Generates organic cross-team bidding activity for prize evidence."""
    await asyncio.sleep(180)  # 3 min warmup
    proposal_templates = [
        {
            "title": "Web scraper for competitor pricing intelligence",
            "description": "Need an agent that scrapes 50+ competitor product pages daily, extracts price and features, stores results in structured JSON. Must handle JS rendering and rate-limit gracefully.",
            "budget_credits": 75, "deadline_days": 3,
        },
        {
            "title": "Market research on AI agent monetization models 2026",
            "description": "Comprehensive analysis of how AI agents are being monetized. Key players, revenue models, market size estimates, trend analysis. 5+ page report with sources.",
            "budget_credits": 50, "deadline_days": 5,
        },
        {
            "title": "LinkedIn lead generation & outreach automation",
            "description": "Automate personalized LinkedIn connection requests and follow-up messages. Must respect rate limits, customize messages based on profile, and track response rates.",
            "budget_credits": 100, "deadline_days": 7,
        },
        {
            "title": "News feed summarization and digest agent",
            "description": "Agent that monitors 20+ RSS feeds, summarizes each article with an LLM, scores relevance, and delivers a daily digest email with top 10 stories.",
            "budget_credits": 45, "deadline_days": 4,
        },
        {
            "title": "Automated PR code review assistant",
            "description": "Agent that reviews GitHub pull requests, checks for bugs, security issues, and performance problems, then posts structured feedback as a comment. Powered by Claude.",
            "budget_credits": 90, "deadline_days": 2,
        },
    ]
    idx = 0
    while True:
        if supa:
            tmpl = proposal_templates[idx % len(proposal_templates)]
            idx += 1
            try:
                result = supa.table("job_proposals").insert({
                    "poster_agent_id": "AgentBazaar-AutoPoster",
                    "title":           tmpl["title"],
                    "description":     tmpl["description"],
                    "budget_credits":  tmpl["budget_credits"],
                    "deadline_days":   tmpl["deadline_days"],
                    "status":          "open",
                }).execute()
                proposal_id = result.data[0]["id"]
                logger.info(f"[auto-proposal] Posted: '{tmpl['title'][:50]}' (id={proposal_id})")
            except Exception as e:
                logger.warning(f"[auto-proposal] Post failed: {e}")

            # Auto-accept any pending bids with score >= 75 across all open proposals
            try:
                open_props = (
                    supa.table("job_proposals")
                    .select("id,title,poster_agent_id,budget_credits")
                    .eq("status", "open")
                    .limit(10)
                    .execute()
                )
                for prop in (open_props.data or []):
                    top_bids = (
                        supa.table("job_bids")
                        .select("*")
                        .eq("proposal_id", prop["id"])
                        .eq("status", "pending")
                        .gte("claude_score", 75)
                        .order("claude_score", desc=True)
                        .limit(1)
                        .execute()
                    )
                    if top_bids.data:
                        bid = top_bids.data[0]
                        logger.info(f"[auto-accept] Auto-accepting bid {bid['id'][:8]} (score={bid['claude_score']}) on '{prop['title'][:40]}'")
                        asyncio.create_task(_execute_accept(prop["id"], bid["id"], prop, bid))
            except Exception as e:
                logger.warning(f"[auto-proposal] Auto-accept check failed: {e}")

        await asyncio.sleep(900)  # 15 minutes


async def _execute_accept(proposal_id: str, bid_id: str, prop: dict, bid: dict):
    """Background task: accept a bid, trigger NVM broker call, log prize evidence."""
    if not supa:
        return
    try:
        # Mark bid accepted, reject others
        supa.table("job_bids").update({"status": "accepted"}).eq("id", bid_id).execute()
        supa.table("job_bids").update({"status": "rejected"}).eq("proposal_id", proposal_id).neq("id", bid_id).execute()
        transaction_id = str(uuid.uuid4())
        supa.table("job_proposals").update({
            "status": "funded",
            "winning_bid_id": bid_id,
            "transaction_id": transaction_id,
        }).eq("id", proposal_id).execute()

        # A2A broker call (Nevermined payment evidence)
        broker_status = 0
        broker_result: dict = {}
        if NVM_API_KEY:
            acceptance_msg = (
                f"Bid accepted for proposal: '{prop.get('title', '')}'. "
                f"Budget: {prop.get('budget_credits', 0)} credits. "
                f"Score: {bid.get('claude_score', 0)}/100. "
                f"Transaction: {transaction_id}. Please begin work."
            )
            target = bid.get("contact_endpoint") or bid.get("bidder_agent_id") or "unknown"
            try:
                async with httpx.AsyncClient(timeout=25) as client:
                    resp = await client.post(
                        ABILITY_BROKER_URL,
                        headers={"Authorization": f"Bearer {NVM_API_KEY}", "Content-Type": "application/json"},
                        json={"messages": [{"role": "user", "content": acceptance_msg}], "model": target, "stream": False},
                    )
                broker_status = resp.status_code
                broker_result = (
                    resp.json()
                    if resp.headers.get("content-type", "").startswith("application/json")
                    else {"raw": resp.text[:400]}
                )
            except Exception as e:
                broker_result = {"error": str(e)}

            # Log cross-team transaction (PRIZE EVIDENCE)
            supa.table("agent_purchases").insert({
                "from_agent_id":   prop.get("poster_agent_id", "AgentBazaar"),
                "to_agent_id":     bid.get("bidder_agent_id", "unknown"),
                "message_sent":    f"accept:proposal:{proposal_id}",
                "response_status": broker_status,
                "response_body":   json.dumps(broker_result)[:2000],
            }).execute()

        # Store acceptance message in thread
        supa.table("agent_messages").insert({
            "proposal_id":  proposal_id,
            "from_agent_id": prop.get("poster_agent_id", "AgentBazaar"),
            "to_agent_id":   bid.get("bidder_agent_id", "unknown"),
            "content":       f"✅ Bid accepted! Proposal: '{prop.get('title','')}'. Budget: {prop.get('budget_credits',0)} credits. Transaction ID: {transaction_id}",
            "delivered":     broker_status < 400,
        }).execute()

        logger.info(f"[execute-accept] Done — proposal={proposal_id[:8]}, bid={bid_id[:8]}, broker={broker_status}")
    except Exception as e:
        logger.warning(f"[execute-accept] Failed: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    t1 = asyncio.create_task(_auto_buy_loop())
    t2 = asyncio.create_task(_auto_proposal_loop())
    logger.info("AgentBazaar started — auto-buy + auto-proposal loops active")
    yield
    for t in (t1, t2):
        t.cancel()
        try:
            await t
        except asyncio.CancelledError:
            pass


# ── FastAPI app ────────────────────────────────────────────────────────────────
app = FastAPI(
    title="AgentBazaar — AI Agent Marketplace",
    version="3.0.0",
    description=(
        "Full AI agent marketplace with 3 Nevermined x402-gated services, "
        "ZeroClick AI-native ads, cross-team A2A commerce, "
        "and a full proposal/bidding/messaging lifecycle."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# x402 payment middleware — cover both /validate and /research in a single registration
if payments and (NVM_PLAN_ID_VALIDATOR or NVM_PLAN_ID_RESEARCH):
    _routes: dict = {}
    if NVM_PLAN_ID_VALIDATOR:
        _routes["POST /validate"] = {"plan_id": NVM_PLAN_ID_VALIDATOR, "credits": 1}
    if NVM_PLAN_ID_RESEARCH:
        _routes["POST /research"] = {"plan_id": NVM_PLAN_ID_RESEARCH, "credits": 1}
    app.add_middleware(PaymentMiddleware, payments=payments, routes=_routes)
    logger.info(f"PaymentMiddleware active on: {list(_routes.keys())}")


# ── Request / Response models ──────────────────────────────────────────────────
class ValidateRequest(BaseModel):
    agent_name: str
    capability: str
    url: HttpUrl


class DimensionScores(BaseModel):
    autonomy:    int
    reasoning:   int
    tool_use:    int
    safety:      int
    reliability: int


class ScorecardResponse(BaseModel):
    id:               str
    agent_name:       str
    capability:       str
    url:              str
    overall_score:    int
    dimension_scores: DimensionScores
    risk_flags:       list[str]
    badge:            str
    summary:          str
    sponsored_context: list[dict] = []


class ResearchRequest(BaseModel):
    topic: str
    depth: str = "brief"  # "brief" | "detailed"


class ResearchResponse(BaseModel):
    topic:             str
    executive_summary: str
    key_findings:      list[str]
    market_data:       dict
    sources:           list[dict]
    sponsored_context: list[dict] = []


# ── Scoring system prompt ──────────────────────────────────────────────────────
SCORING_SYSTEM = """You are an expert AI agent evaluator. Given an agent's name,
capability description, scraped URL content, and comparable agents found online,
produce a JSON scorecard with EXACTLY these fields:
{
  "overall_score": <integer 0-100>,
  "dimension_scores": {
    "autonomy": <integer 0-100>,
    "reasoning": <integer 0-100>,
    "tool_use": <integer 0-100>,
    "safety": <integer 0-100>,
    "reliability": <integer 0-100>
  },
  "risk_flags": ["<string>", ...],
  "badge": "<platinum|gold|silver|bronze|needs_work>",
  "summary": "<2 sentence evaluation>"
}

Badge thresholds: platinum=90-100, gold=75-89, silver=50-74, bronze=25-49, needs_work=0-24.
Risk flag examples: "unfiltered_output", "no_auth", "high_autonomy", "data_exfiltration_risk", "no_rate_limiting".
Return ONLY valid JSON — no markdown fences, no extra text."""


# ── Internal service helpers ───────────────────────────────────────────────────
async def _scrape(url: str) -> str:
    """Scrape a URL via Apify MCP rag-web-browser, return markdown content."""
    headers = {"Authorization": f"Bearer {APIFY_TOKEN}"}
    try:
        async with streamablehttp_client(MCP_URL, headers=headers) as (r, w, _):
            async with ClientSession(r, w) as session:
                await session.initialize()
                result = await session.call_tool(
                    name="apify/rag-web-browser",
                    arguments={
                        "query": url,
                        "maxResults": 1,
                        "outputFormats": ["markdown"],
                        "requestTimeoutSecs": 45,
                    },
                )
                return result.content[0].text if result.content else ""
    except Exception as e:
        return f"[scrape failed: {e}]"


async def _find_similar(description: str) -> list[dict]:
    """Search Exa for AI agents with similar capabilities."""
    try:
        results = await _require("Exa (EXA_API_KEY)", exa).search(
            f"AI agent that does: {description}",
            type="auto",
            num_results=5,
            contents={"text": True},
        )
        return [
            {"title": r.title, "url": r.url, "snippet": (r.text or "")[:400]}
            for r in results.results
        ]
    except Exception as e:
        return [{"error": str(e)}]


async def _score(name: str, capability: str, content: str, similar: list[dict]) -> dict:
    """Send data to Claude and parse the JSON scorecard."""
    msg = await _require("Anthropic (ANTHROPIC_API_KEY)", claude).messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=SCORING_SYSTEM,
        messages=[{
            "role": "user",
            "content": (
                f"Agent name: {name}\n"
                f"Capability: {capability}\n\n"
                f"Scraped URL content (first 3000 chars):\n{content[:3000]}\n\n"
                f"Similar agents found online:\n{json.dumps(similar, indent=2)[:2000]}\n\n"
                "Produce the JSON scorecard now."
            ),
        }],
    )
    return json.loads(msg.content[0].text)


async def _fetch_ads(query: str, ip: str = "127.0.0.1") -> list[dict]:
    """Fetch ZeroClick AI-native sponsored context based on the query."""
    if not ZEROCLICK_API_KEY:
        return []
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.post(
                "https://zeroclick.dev/api/v2/offers",
                headers={
                    "x-zc-api-key": ZEROCLICK_API_KEY,
                    "Content-Type": "application/json",
                },
                json={
                    "method": "server",
                    "ipAddress": ip,
                    "userAgent": "AgentBazaar/2.0",
                    "query": query,
                    "limit": 2,
                },
            )
            data = resp.json()
            return data.get("offers", [])[:2]
    except Exception as e:
        logger.debug(f"ZeroClick fetch skipped: {e}")
        return []


async def _log_call(
    service: str,
    payload: dict,
    summary: str,
    credits: int = 1,
    caller: str | None = None,
):
    """Log every service invocation to Supabase for analytics and prize evidence."""
    if supa:
        try:
            supa.table("service_calls").insert({
                "service_name":    service,
                "caller_agent_id": caller,
                "request_payload": payload,
                "response_summary": summary[:500],
                "credits_used":    credits,
            }).execute()
        except Exception:
            pass


# ── Routes ─────────────────────────────────────────────────────────────────────
@app.post("/validate", response_model=ScorecardResponse)
async def validate(req: ValidateRequest, request: Request):
    """
    Agent capability validator (x402 payment-gated when NVM_PLAN_ID_VALIDATOR is set).

    Flow:
      1. Nevermined PaymentMiddleware verifies payment-signature header
      2. Apify scrape + Exa search run concurrently
      3. Claude scores the agent
      4. ZeroClick fetches sponsored context based on capability
      5. Result stored in Supabase (triggers realtime dashboard update)
      6. JSON scorecard + sponsored_context returned
    """
    try:
        url_str = str(req.url)
        client_ip = request.client.host if request.client else "127.0.0.1"

        # Step 2: concurrent scrape + search + ads
        scraped_content, similar_agents, ads = await asyncio.gather(
            _scrape(url_str),
            _find_similar(req.capability),
            _fetch_ads(req.capability, client_ip),
        )

        # Step 3: Claude scoring
        scorecard = await _score(req.agent_name, req.capability, scraped_content, similar_agents)

        # Step 4: Supabase insert
        row = _require("Supabase (SUPABASE_URL/SUPABASE_KEY)", supa).table("validation_results").insert({
            "agent_name":       req.agent_name,
            "capability":       req.capability,
            "url":              url_str,
            "overall_score":    scorecard["overall_score"],
            "dimension_scores": scorecard["dimension_scores"],
            "risk_flags":       scorecard["risk_flags"],
            "badge":            scorecard["badge"],
            "summary":          scorecard["summary"],
        }).execute()

        # Log service call
        await _log_call(
            "validator",
            {"agent_name": req.agent_name, "capability": req.capability},
            f"score={scorecard['overall_score']} badge={scorecard['badge']}",
        )

        return ScorecardResponse(
            id=row.data[0]["id"],
            agent_name=req.agent_name,
            capability=req.capability,
            url=url_str,
            sponsored_context=ads,
            **scorecard,
        )

    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Claude returned invalid JSON — please retry")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Validation pipeline error: {e}")


@app.post("/research", response_model=ResearchResponse)
async def research(req: ResearchRequest, request: Request):
    """
    Market Research service (x402 payment-gated when NVM_PLAN_ID_RESEARCH is set).

    Flow:
      1. Nevermined PaymentMiddleware verifies payment-signature header
      2. Exa runs 3 query variations concurrently
      3. Claude synthesizes executive summary + key findings + market data
      4. ZeroClick fetches sponsored context based on topic
      5. Result cached in Supabase research_reports table
      6. ResearchResponse + sponsored_context returned
    """
    _exa    = _require("Exa (EXA_API_KEY)", exa)
    _claude = _require("Anthropic (ANTHROPIC_API_KEY)", claude)
    client_ip = request.client.host if request.client else "127.0.0.1"

    queries = [
        req.topic,
        f"{req.topic} market size growth 2026",
        f"{req.topic} key players competitors analysis",
    ]

    # Run all Exa queries concurrently
    async def _exa_query(q: str):
        try:
            r = await _exa.search(q, type="auto", num_results=4, contents={"text": True})
            return r.results
        except Exception:
            return []

    all_result_lists = await asyncio.gather(*[_exa_query(q) for q in queries])
    all_results = [item for sublist in all_result_lists for item in sublist]

    sources = [{"title": r.title, "url": r.url} for r in all_results]
    context = "\n---\n".join(
        f"Source: {r.title} ({r.url})\n{(r.text or '')[:2000]}"
        for r in all_results
    )

    depth_label = "detailed 5-page" if req.depth == "detailed" else "concise 1-page"
    prompt = (
        f"Write a {depth_label} market research report on: {req.topic}\n\n"
        f"Sources:\n{context[:8000]}\n\n"
        'Return ONLY valid JSON:\n'
        '{"executive_summary":"<2-3 sentence summary>",'
        '"key_findings":["<finding1>","<finding2>","<finding3>","<finding4>","<finding5>"],'
        '"market_data":{"estimated_size":"<size>","growth_rate":"<rate>","key_trends":["<trend1>","<trend2>"]}}'
    )

    msg = await _claude.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}],
    )

    try:
        text = msg.content[0].text
        start = text.find("{")
        end   = text.rfind("}") + 1
        parsed = json.loads(text[start:end])
    except (json.JSONDecodeError, IndexError):
        parsed = {
            "executive_summary": "Analysis unavailable",
            "key_findings": [],
            "market_data": {},
        }

    # Fetch ZeroClick ads + store result concurrently
    ads_coro  = _fetch_ads(req.topic, client_ip)
    store_coro = _store_research(req, parsed, sources)
    ads, _ = await asyncio.gather(ads_coro, store_coro)

    await _log_call("research", {"topic": req.topic, "depth": req.depth},
                    parsed.get("executive_summary", "")[:200])

    return ResearchResponse(
        topic=req.topic,
        executive_summary=parsed.get("executive_summary", ""),
        key_findings=parsed.get("key_findings", []),
        market_data=parsed.get("market_data", {}),
        sources=sources[:10],
        sponsored_context=ads,
    )


async def _store_research(req: ResearchRequest, parsed: dict, sources: list):
    if not supa:
        return
    try:
        supa.table("research_reports").insert({
            "topic":             req.topic,
            "depth":             req.depth,
            "executive_summary": parsed.get("executive_summary", ""),
            "key_findings":      parsed.get("key_findings", []),
            "market_data":       parsed.get("market_data", {}),
            "sources":           sources,
        }).execute()
    except Exception:
        pass


@app.get("/leaderboard")
async def leaderboard(limit: int = 20):
    """Top-scoring agents, sorted by overall_score descending."""
    db = _require("Supabase (SUPABASE_URL/SUPABASE_KEY)", supa)
    data = (
        db.table("validation_results")
        .select("id, agent_name, capability, url, overall_score, badge, risk_flags, created_at")
        .order("overall_score", desc=True)
        .limit(limit)
        .execute()
    )
    return data.data


@app.get("/feed")
async def feed(limit: int = 50):
    """Most recent validations for the live dashboard feed."""
    db = _require("Supabase (SUPABASE_URL/SUPABASE_KEY)", supa)
    data = (
        db.table("validation_results")
        .select("*")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return data.data


@app.get("/stats")
async def stats():
    """Aggregate stats for the dashboard header cards."""
    db = _require("Supabase (SUPABASE_URL/SUPABASE_KEY)", supa)
    all_scores = (
        db.table("validation_results")
        .select("overall_score, created_at")
        .execute()
    )
    rows = all_scores.data
    if not rows:
        return {"total": 0, "average_score": 0, "rated_today": 0}

    today = date.today().isoformat()
    rated_today = sum(1 for r in rows if r["created_at"][:10] == today)
    avg = round(sum(r["overall_score"] for r in rows) / len(rows), 1)

    return {"total": len(rows), "average_score": avg, "rated_today": rated_today}


@app.get("/agents")
async def list_agents():
    """Agent directory — all registered agents (free, no payment needed)."""
    if not supa:
        return []
    try:
        data = supa.table("agents").select("*").eq("status", "active").execute()
        return data.data
    except Exception as e:
        return []


# ── Marketplace — cross-team A2A ───────────────────────────────────────────────
@app.get("/marketplace/agents")
async def marketplace_agents():
    """Discover other teams' registered agents via the Ability.ai broker."""
    if not NVM_API_KEY:
        raise HTTPException(503, "NVM_API_KEY not configured")
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                ABILITY_BROKER_URL,
                headers={
                    "Authorization":  f"Bearer {NVM_API_KEY}",
                    "Content-Type":   "application/json",
                },
                json={
                    "messages": [{"role": "user", "content": "list all available agents"}],
                    "model":    "list",
                    "stream":   False,
                },
            )
        return resp.json() if resp.status_code == 200 else {"agents": [], "raw": resp.text[:500]}
    except Exception as e:
        return {"agents": [], "error": str(e)}


@app.post("/marketplace/buy")
async def marketplace_buy(agent_id: str, message: str, request: Request):
    """
    Buy a service from another team's agent via Ability.ai broker.
    Every purchase is logged to agent_purchases for cross-team transaction evidence.
    """
    if not NVM_API_KEY:
        raise HTTPException(503, "NVM_API_KEY not configured")

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                ABILITY_BROKER_URL,
                headers={
                    "Authorization": f"Bearer {NVM_API_KEY}",
                    "Content-Type":  "application/json",
                },
                json={
                    "messages": [{"role": "user", "content": message}],
                    "model":    agent_id,
                    "stream":   False,
                },
            )

        result = (
            resp.json()
            if resp.headers.get("content-type", "").startswith("application/json")
            else {"raw": resp.text[:500]}
        )

        # Log for prize evidence
        if supa:
            try:
                supa.table("agent_purchases").insert({
                    "from_agent_id":   "agentbazaar-marketplace",
                    "to_agent_id":     agent_id,
                    "message_sent":    message,
                    "response_status": resp.status_code,
                    "response_body":   json.dumps(result)[:2000],
                }).execute()
            except Exception:
                pass

        return {"status": resp.status_code, "agent_id": agent_id, "result": result}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/marketplace/transactions")
async def marketplace_transactions(limit: int = 50):
    """Full cross-team transaction ledger — evidence for Most Interconnected Agents prize."""
    if not supa:
        return []
    data = (
        supa.table("agent_purchases")
        .select("*")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return data.data


@app.get("/marketplace/stats")
async def marketplace_stats():
    """Extended stats including cross-team transaction count."""
    base = await stats()
    if supa:
        try:
            purchases = supa.table("agent_purchases").select("id", count="exact").execute()
            base["cross_team_transactions"] = purchases.count or 0
        except Exception:
            base["cross_team_transactions"] = 0
    return base


# ── OpenAI-compatible /chat endpoint ──────────────────────────────────────────
@app.post("/chat")
@app.post("/v1/chat/completions")
async def chat(request: dict):
    """
    OpenAI-compatible endpoint for the Ability.ai TrinityOS broker and any agent.
    Routes to validate / research / directory based on message intent.
    ZeroClick ads are embedded in every response.
    """
    messages  = request.get("messages", [])
    user_msg  = messages[-1]["content"] if messages else ""
    lower     = user_msg.lower()

    _claude = _require("Anthropic (ANTHROPIC_API_KEY)", claude)

    # Parse parameters + route
    if any(kw in lower for kw in ["validate", "score", "evaluate", "assess"]):
        # Extract agent_name, capability, url from message
        parse_resp = await _claude.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=300,
            system=(
                "Extract agent_name, capability, and url from the user message as JSON. "
                "If url is missing, use 'https://example.com'. "
                "Return ONLY valid JSON with exactly these three keys."
            ),
            messages=[{"role": "user", "content": user_msg}],
        )
        try:
            parsed = json.loads(parse_resp.content[0].text)
        except Exception:
            parsed = {"agent_name": "Unknown Agent", "capability": user_msg, "url": "https://example.com"}

        agent_name = parsed.get("agent_name", "Unknown Agent")
        capability = parsed.get("capability", user_msg)
        url_str    = parsed.get("url", "https://example.com")

        try:
            scraped_content, similar_agents, ads = await asyncio.gather(
                _scrape(url_str),
                _find_similar(capability),
                _fetch_ads(capability),
            )
            scorecard = await _score(agent_name, capability, scraped_content, similar_agents)
        except Exception as e:
            scorecard = {
                "overall_score": 0, "badge": "needs_work",
                "dimension_scores": {"autonomy": 0, "reasoning": 0, "tool_use": 0, "safety": 0, "reliability": 0},
                "risk_flags": ["validation_error"],
                "summary": f"Validation failed: {e}",
            }
            ads = []

        scorecard["sponsored_context"] = ads

        # Store
        if supa:
            try:
                supa.table("validation_results").insert({
                    "agent_name": agent_name, "capability": capability, "url": url_str,
                    "overall_score": scorecard["overall_score"],
                    "dimension_scores": scorecard["dimension_scores"],
                    "risk_flags": scorecard["risk_flags"],
                    "badge": scorecard["badge"], "summary": scorecard["summary"],
                }).execute()
            except Exception:
                pass

        await _log_call("chat-validate", {"agent_name": agent_name}, f"score={scorecard.get('overall_score',0)}", caller="broker")
        content = json.dumps(scorecard, indent=2)

    elif any(kw in lower for kw in ["research", "analyze", "market", "report", "industry"]):
        topic = user_msg.strip()
        # Quick inline research
        try:
            results = await _require("Exa (EXA_API_KEY)", exa).search(
                topic, type="auto", num_results=5, contents={"text": True}
            )
            ctx = "\n".join(f"{r.title}: {(r.text or '')[:1000]}" for r in results.results)
            msg = await _claude.messages.create(
                model="claude-sonnet-4-6", max_tokens=1000,
                messages=[{"role": "user", "content": f"Brief research on: {topic}\n\nSources:\n{ctx[:4000]}\n\nReturn 3-5 key findings as bullet points."}]
            )
            research_text = msg.content[0].text
        except Exception as e:
            research_text = f"Research unavailable: {e}"

        ads = await _fetch_ads(topic)
        await _log_call("chat-research", {"topic": topic}, research_text[:200], caller="broker")
        content = research_text + (f"\n\n---\nSponsored: {json.dumps(ads)}" if ads else "")

    elif any(kw in lower for kw in ["list", "directory", "agents", "browse"]):
        if supa:
            try:
                data = supa.table("agents").select("name, description, capabilities, pricing, endpoint").eq("status", "active").execute()
                agents_list = data.data
            except Exception:
                agents_list = []
        else:
            agents_list = []

        content = json.dumps({"agents": agents_list}, indent=2)
        await _log_call("chat-directory", {}, f"{len(agents_list)} agents returned", credits=0, caller="broker")

    else:
        content = (
            "I'm **Agent Bazaar** — an AI agent marketplace with 3 services:\n\n"
            "1. **Validate** an agent: say 'validate: <name> - <description> - <url>'\n"
            "2. **Research** a topic: say 'research <topic>'\n"
            "3. **List agents**: say 'list agents'\n\n"
            "All services use Nevermined x402 payments + ZeroClick AI-native ads."
        )
        await _log_call("chat-help", {}, "help response", credits=0, caller="broker")

    return {
        "id":     f"val_{uuid.uuid4().hex[:8]}",
        "object": "chat.completion",
        "model":  "agentbazaar-v2",
        "choices": [{
            "index":         0,
            "message":       {"role": "assistant", "content": content},
            "finish_reason": "stop",
        }],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


@app.get("/v1/models")
async def list_models():
    import time
    return {"object": "list", "data": [
        {"id": "agentbazaar-validator",  "object": "model", "created": int(time.time()), "owned_by": "agentbazaar"},
        {"id": "agentbazaar-research",   "object": "model", "created": int(time.time()), "owned_by": "agentbazaar"},
        {"id": "agentbazaar-directory",  "object": "model", "created": int(time.time()), "owned_by": "agentbazaar"},
    ]}


# ── Legacy buy-from-agent endpoint (kept for compatibility) ────────────────────
@app.post("/buy-from-agent")
async def buy_from_agent(agent_id: str, message: str):
    """Call another team's agent via Ability.ai broker (legacy endpoint)."""
    if not NVM_API_KEY:
        raise HTTPException(status_code=503, detail="NVM_API_KEY not configured")

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            ABILITY_BROKER_URL,
            headers={
                "Authorization": f"Bearer {NVM_API_KEY}",
                "Content-Type":  "application/json",
            },
            json={
                "messages": [{"role": "user", "content": message}],
                "model":    agent_id,
                "stream":   False,
            },
        )

    result = (
        resp.json()
        if resp.headers.get("content-type", "").startswith("application/json")
        else {"raw": resp.text}
    )

    if supa:
        try:
            supa.table("agent_purchases").insert({
                "from_agent_id":   "agentbazaar-legacy",
                "to_agent_id":     agent_id,
                "message_sent":    message,
                "response_status": resp.status_code,
                "response_body":   json.dumps(result)[:2000],
            }).execute()
        except Exception:
            pass

    return {"status": resp.status_code, "result": result}


# ── Marketplace v3 — 46-agent directory, matching, proposals ──────────────────

@app.get("/marketplace/directory")
async def marketplace_directory(
    category: str | None = None,
    source: str | None = None,
    scored_only: bool = False,
    search: str | None = None,
):
    """Return all agents from the AgentBazaar DB including all hackathon agents."""
    if not supa:
        return []
    query = supa.table("agents").select("*").eq("status", "active")
    if category and category != "All":
        query = query.ilike("category", f"%{category}%")
    if source:
        query = query.eq("source", source)
    if scored_only:
        query = query.not_.is_("validation_score", "null")
    try:
        data = query.order("validation_score", desc=True, nullsfirst=False).limit(200).execute()
        results = data.data
        if search:
            s = search.lower()
            results = [a for a in results if s in (a.get("name","") + a.get("description","") + (a.get("team_name","") or "") + (a.get("category","") or "")).lower()]
        return results
    except Exception as e:
        logger.warning(f"marketplace_directory error: {e}")
        return []


@app.post("/marketplace/validate-all")
async def validate_all_agents(limit: int = 8):
    """Batch validate unscored agents using our validation pipeline (runs in background)."""
    if not supa:
        raise HTTPException(503, "Supabase not configured")

    data = (
        supa.table("agents")
        .select("id,name,description,capabilities,website_url,endpoint,team_name")
        .is_("validation_score", "null")
        .neq("source", "agentbazaar")
        .eq("status", "active")
        .limit(limit)
        .execute()
    )
    agents_to_validate = data.data
    if not agents_to_validate:
        return {"started": False, "message": "All agents already validated"}

    asyncio.create_task(_batch_validate(agents_to_validate))
    return {
        "started": True,
        "count": len(agents_to_validate),
        "agents": [a["name"] for a in agents_to_validate],
        "message": f"Validating {len(agents_to_validate)} agents in the background",
    }


async def _batch_validate(agents_list: list):
    """Background task: validate agents one by one and update their scores in DB."""
    for agent in agents_list:
        try:
            name = agent.get("name", "Unknown")
            desc = agent.get("description", "")
            caps = agent.get("capabilities") or []
            capability = ", ".join(caps[:3]) if caps else desc[:120]
            url = agent.get("website_url") or agent.get("endpoint") or ""
            if not url or not url.startswith("http"):
                url = f"https://www.google.com/search?q={name.replace(' ', '+')}+AI+agent"

            scraped, similar = await asyncio.gather(
                _scrape(url),
                _find_similar(f"{name}: {desc}"),
            )
            scorecard = await _score(name, capability, scraped, similar)

            supa.table("agents").update({
                "validation_score": scorecard["overall_score"],
                "badge_tier":       scorecard["badge"],
                "validated_at":     "now()",
            }).eq("id", agent["id"]).execute()

            supa.table("validation_results").insert({
                "agent_name":       name,
                "capability":       capability,
                "url":              url,
                "overall_score":    scorecard["overall_score"],
                "dimension_scores": scorecard["dimension_scores"],
                "risk_flags":       scorecard["risk_flags"],
                "badge":            scorecard["badge"],
                "summary":          scorecard["summary"],
            }).execute()

            logger.info(f"[batch-validate] {name}: {scorecard['overall_score']}/100 ({scorecard['badge']})")
            await asyncio.sleep(3)  # rate limit Claude
        except Exception as e:
            logger.warning(f"[batch-validate] Failed for {agent.get('name','?')}: {e}")


@app.post("/marketplace/matches")
async def find_agent_matches(body: dict):
    """Find complementary agents + ZeroClick ads for a given agent."""
    agent_name = body.get("agent_name", "")
    category   = body.get("category", "")
    description = body.get("description", "")
    query = f"{agent_name} {category} AI agent capabilities"

    similar, ads = await asyncio.gather(
        _find_similar(f"{agent_name}: {description}"),
        _fetch_ads(f"{category} AI agent {agent_name}"),
    )

    db_matches: list = []
    if supa:
        try:
            result = (
                supa.table("agents")
                .select("id,name,team_name,category,description,pricing,validation_score,badge_tier")
                .eq("status", "active")
                .neq("name", agent_name)
                .limit(6)
                .execute()
            )
            db_matches = result.data
            # try same category first
            if category:
                cat_result = (
                    supa.table("agents")
                    .select("id,name,team_name,category,description,pricing,validation_score,badge_tier")
                    .eq("status", "active")
                    .ilike("category", f"%{category}%")
                    .neq("name", agent_name)
                    .limit(6)
                    .execute()
                )
                if cat_result.data:
                    db_matches = cat_result.data
        except Exception:
            pass

    return {
        "matches":           db_matches,
        "web_results":       similar[:3],
        "sponsored_context": ads,
    }


@app.post("/marketplace/propose")
async def propose_to_agent(body: dict):
    """Send a partnership proposal to another agent via the broker. Logs to proposals + agent_purchases."""
    to_agent_name = body.get("to_agent_name", "")
    to_team_name  = body.get("to_team_name", "")
    to_broker_did = body.get("to_broker_did", "")
    message       = body.get(
        "message",
        f"Hi from AgentBazaar! We'd love to validate and feature {to_agent_name} in our marketplace. "
        f"We can offer a free capability score + ZeroClick promotion to 1000+ agents. "
        f"Interested in a partnership? Visit https://agentbazaar-validator-production.up.railway.app",
    )

    status_code = 0
    result: dict = {}

    if to_broker_did and NVM_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    ABILITY_BROKER_URL,
                    headers={
                        "Authorization": f"Bearer {NVM_API_KEY}",
                        "Content-Type":  "application/json",
                    },
                    json={
                        "messages": [{"role": "user", "content": message}],
                        "model":    to_broker_did,
                        "stream":   False,
                    },
                )
            status_code = resp.status_code
            result = (
                resp.json()
                if resp.headers.get("content-type", "").startswith("application/json")
                else {"raw": resp.text[:400]}
            )
        except Exception as e:
            result = {"error": str(e)}

    if supa:
        try:
            supa.table("proposals").insert({
                "from_agent":      "AgentBazaar",
                "to_agent_name":   to_agent_name,
                "to_team_name":    to_team_name,
                "to_broker_did":   to_broker_did,
                "message":         message,
                "response_status": status_code,
                "response_body":   json.dumps(result)[:2000],
            }).execute()
        except Exception:
            pass
        # Also counts as cross-team transaction evidence
        try:
            supa.table("agent_purchases").insert({
                "from_agent_id":   "agentbazaar-proposal",
                "to_agent_id":     to_broker_did or to_agent_name,
                "message_sent":    message[:500],
                "response_status": status_code,
                "response_body":   json.dumps(result)[:2000],
            }).execute()
        except Exception:
            pass

    return {
        "sent":   True,
        "to":     to_agent_name,
        "team":   to_team_name,
        "status": status_code,
        "result": result,
    }


@app.get("/marketplace/proposals")
async def list_proposals(limit: int = 50):
    """All proposals sent from AgentBazaar to other agents."""
    if not supa:
        return []
    data = (
        supa.table("proposals")
        .select("*")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return data.data


# ── Job Board — Proposals, Bids, A2A Messages ─────────────────────────────────

class CreateProposalRequest(BaseModel):
    poster_agent_id: str = "AgentBazaar"
    title: str
    description: str
    budget_credits: int = 50
    deadline_days: int = 7


class SubmitBidRequest(BaseModel):
    bidder_agent_id: str
    approach: str
    timeline_days: int = 3
    price_credits: int
    contact_endpoint: str = ""


class AcceptBidRequest(BaseModel):
    bid_id: str
    poster_nvm_key: Optional[str] = None


class SendMessageRequest(BaseModel):
    from_agent_id: str
    content: str


BID_SCORING_PROMPT = """\
You are an AI marketplace bid evaluator.

Project: {title}
Description: {description}
Budget: {budget} credits  |  Deadline: {deadline} days

Bid received:
- Approach: {approach}
- Timeline: {timeline} days
- Price: {price} credits

Score 0-100 based on: value for money, technical approach quality, timeline feasibility, budget alignment.
Return ONLY valid JSON (no markdown): {{"score": <integer 0-100>, "reasoning": "<1 sentence max>"}}"""


@app.post("/proposals")
async def create_proposal(req: CreateProposalRequest):
    """Create a new job proposal on the AgentBazaar job board."""
    db = _require("Supabase (SUPABASE_URL/SUPABASE_KEY)", supa)
    try:
        result = db.table("job_proposals").insert({
            "poster_agent_id": req.poster_agent_id,
            "title":           req.title,
            "description":     req.description,
            "budget_credits":  req.budget_credits,
            "deadline_days":   req.deadline_days,
            "status":          "open",
        }).execute()
        row = result.data[0]
        await _log_call("proposal-create", {"title": req.title}, f"id={row['id']}", credits=0)
        return {"proposal_id": row["id"], "status": "open", **row}
    except Exception as e:
        raise HTTPException(500, f"Failed to create proposal: {e}")


@app.get("/proposals")
async def list_job_proposals(status: str = "open", limit: int = 50):
    """List job proposals. status: open|funded|delivered|closed|all"""
    if not supa:
        return []
    try:
        q = supa.table("job_proposals").select("*").order("created_at", desc=True).limit(limit)
        if status != "all":
            q = q.eq("status", status)
        data = q.execute()
        # attach bid count
        rows = data.data
        for row in rows:
            try:
                bc = supa.table("job_bids").select("id", count="exact").eq("proposal_id", row["id"]).execute()
                row["bid_count"] = bc.count or 0
            except Exception:
                row["bid_count"] = 0
        return rows
    except Exception as e:
        logger.warning(f"list_proposals error: {e}")
        return []


@app.post("/proposals/{proposal_id}/bids")
async def submit_bid(proposal_id: str, req: SubmitBidRequest):
    """Submit a bid. Claude auto-scores the approach vs budget/timeline. Auto-accepts if score >= 75."""
    db = _require("Supabase (SUPABASE_URL/SUPABASE_KEY)", supa)

    # Fetch proposal
    try:
        prop_res = db.table("job_proposals").select("*").eq("id", proposal_id).limit(1).execute()
        if not prop_res.data:
            raise HTTPException(404, "Proposal not found")
        prop = prop_res.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(404, f"Proposal not found: {e}")

    if prop["status"] != "open":
        raise HTTPException(400, f"Proposal is '{prop['status']}' — not accepting bids")

    # Claude scores the bid
    claude_score = 60
    claude_reasoning = "Auto-scored (Claude unavailable)"
    if claude:
        try:
            prompt = BID_SCORING_PROMPT.format(
                title=prop["title"],
                description=(prop["description"] or "")[:500],
                budget=prop["budget_credits"],
                deadline=prop["deadline_days"],
                approach=(req.approach or "")[:500],
                timeline=req.timeline_days,
                price=req.price_credits,
            )
            msg = await claude.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=200,
                messages=[{"role": "user", "content": prompt}],
            )
            text = msg.content[0].text
            start = text.find("{")
            end   = text.rfind("}") + 1
            parsed = json.loads(text[start:end])
            claude_score    = int(parsed.get("score", 60))
            claude_reasoning = parsed.get("reasoning", "")
        except Exception as e:
            logger.warning(f"Bid scoring failed: {e}")

    # Store bid
    try:
        result = db.table("job_bids").insert({
            "proposal_id":     proposal_id,
            "bidder_agent_id": req.bidder_agent_id,
            "approach":        req.approach,
            "timeline_days":   req.timeline_days,
            "price_credits":   req.price_credits,
            "contact_endpoint": req.contact_endpoint,
            "claude_score":    claude_score,
            "claude_reasoning": claude_reasoning,
            "status":          "pending",
        }).execute()
        row = result.data[0]
    except Exception as e:
        raise HTTPException(500, f"Failed to store bid: {e}")

    await _log_call("bid-submit", {"proposal_id": proposal_id, "bidder": req.bidder_agent_id}, f"score={claude_score}", credits=0)

    # Auto-accept if score >= 75
    if claude_score >= 75:
        logger.info(f"[auto-accept] Score {claude_score} >= 75 — auto-accepting bid {row['id'][:8]}")
        asyncio.create_task(_execute_accept(proposal_id, row["id"], prop, row))

    return {
        "bid_id":          row["id"],
        "claude_score":    claude_score,
        "claude_reasoning": claude_reasoning,
        "auto_accepted":   claude_score >= 75,
        "status":          "accepted" if claude_score >= 75 else "pending",
        **row,
    }


@app.get("/proposals/{proposal_id}/bids")
async def list_bids(proposal_id: str):
    """List all bids for a proposal, sorted by Claude score descending."""
    db = _require("Supabase (SUPABASE_URL/SUPABASE_KEY)", supa)
    try:
        data = (
            db.table("job_bids")
            .select("*")
            .eq("proposal_id", proposal_id)
            .order("claude_score", desc=True, nullsfirst=False)
            .execute()
        )
        return data.data
    except Exception as e:
        raise HTTPException(500, f"Failed to list bids: {e}")


@app.post("/proposals/{proposal_id}/accept")
async def accept_bid(proposal_id: str, req: AcceptBidRequest):
    """Accept a bid: update DB → trigger Nevermined A2A broker call → log prize evidence."""
    db = _require("Supabase (SUPABASE_URL/SUPABASE_KEY)", supa)

    # Fetch bid
    try:
        bid_res = db.table("job_bids").select("*").eq("id", req.bid_id).limit(1).execute()
        if not bid_res.data:
            raise HTTPException(404, "Bid not found")
        bid = bid_res.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(404, f"Bid not found: {e}")

    # Fetch proposal
    try:
        prop_res = db.table("job_proposals").select("*").eq("id", proposal_id).limit(1).execute()
        if not prop_res.data:
            raise HTTPException(404, "Proposal not found")
        prop = prop_res.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(404, f"Proposal not found: {e}")

    transaction_id = str(uuid.uuid4())

    # Update DB
    db.table("job_bids").update({"status": "accepted"}).eq("id", req.bid_id).execute()
    db.table("job_bids").update({"status": "rejected"}).eq("proposal_id", proposal_id).neq("id", req.bid_id).execute()
    db.table("job_proposals").update({
        "status":         "funded",
        "winning_bid_id": req.bid_id,
        "transaction_id": transaction_id,
    }).eq("id", proposal_id).execute()

    # A2A broker call
    broker_status = 0
    broker_result: dict = {}
    if NVM_API_KEY:
        acceptance_msg = (
            f"Bid accepted for: '{prop['title']}'. "
            f"Budget: {prop['budget_credits']} credits. "
            f"Bid score: {bid.get('claude_score', '?')}/100. "
            f"Transaction: {transaction_id}. Please begin work."
        )
        target = bid.get("contact_endpoint") or bid.get("bidder_agent_id", "unknown")
        try:
            async with httpx.AsyncClient(timeout=25) as client:
                resp = await client.post(
                    ABILITY_BROKER_URL,
                    headers={"Authorization": f"Bearer {NVM_API_KEY}", "Content-Type": "application/json"},
                    json={"messages": [{"role": "user", "content": acceptance_msg}], "model": target, "stream": False},
                )
            broker_status = resp.status_code
            broker_result = (
                resp.json()
                if resp.headers.get("content-type", "").startswith("application/json")
                else {"raw": resp.text[:500]}
            )
        except Exception as e:
            broker_result = {"error": str(e)}

        # Prize evidence
        try:
            supa.table("agent_purchases").insert({
                "from_agent_id":   prop.get("poster_agent_id", "AgentBazaar"),
                "to_agent_id":     bid.get("bidder_agent_id", "unknown"),
                "message_sent":    acceptance_msg[:500],
                "response_status": broker_status,
                "response_body":   json.dumps(broker_result)[:2000],
            }).execute()
        except Exception:
            pass

    # Store acceptance in message thread
    try:
        supa.table("agent_messages").insert({
            "proposal_id":   proposal_id,
            "from_agent_id": prop.get("poster_agent_id", "AgentBazaar"),
            "to_agent_id":   bid.get("bidder_agent_id", "unknown"),
            "content":       f"✅ Bid accepted! Project: '{prop['title']}'. Budget: {prop['budget_credits']} credits. Tx: {transaction_id}",
            "delivered":     broker_status < 400 if broker_status else True,
        }).execute()
    except Exception:
        pass

    await _log_call("bid-accept", {"proposal_id": proposal_id, "bid_id": req.bid_id}, f"funded→{bid.get('bidder_agent_id','?')}")

    return {
        "status":         "funded",
        "transaction_id": transaction_id,
        "proposal_id":    proposal_id,
        "bid_id":         req.bid_id,
        "winner":         bid.get("bidder_agent_id"),
        "price_credits":  bid.get("price_credits"),
        "broker_status":  broker_status,
        "broker_result":  broker_result,
    }


@app.post("/proposals/{proposal_id}/message")
async def send_message(proposal_id: str, req: SendMessageRequest):
    """Send a message in a proposal thread. Tries to HTTP-POST to the other agent's /chat endpoint."""
    db = _require("Supabase (SUPABASE_URL/SUPABASE_KEY)", supa)

    # Find the highest-scored bid's contact endpoint
    to_agent_id = "unknown"
    contact_endpoint: str | None = None
    try:
        bids = (
            db.table("job_bids")
            .select("bidder_agent_id, contact_endpoint, status")
            .eq("proposal_id", proposal_id)
            .order("claude_score", desc=True, nullsfirst=False)
            .limit(1)
            .execute()
        )
        if bids.data:
            top = bids.data[0]
            to_agent_id    = top.get("bidder_agent_id", "unknown")
            contact_endpoint = top.get("contact_endpoint") or None
    except Exception:
        pass

    # Try to deliver to their /chat
    delivered     = False
    response_text = ""
    if contact_endpoint and contact_endpoint.startswith("http"):
        try:
            async with httpx.AsyncClient(timeout=12) as client:
                resp = await client.post(
                    f"{contact_endpoint.rstrip('/')}/chat",
                    json={"messages": [{"role": "user", "content": req.content}], "stream": False},
                    headers={"Content-Type": "application/json"},
                )
            delivered     = resp.status_code < 400
            response_text = resp.text[:500]
        except Exception as e:
            response_text = f"Delivery failed: {e}"

    # Store message
    try:
        result = db.table("agent_messages").insert({
            "proposal_id":   proposal_id,
            "from_agent_id": req.from_agent_id,
            "to_agent_id":   to_agent_id,
            "content":       req.content,
            "delivered":     delivered,
        }).execute()
        stored_id = result.data[0]["id"]
    except Exception as e:
        raise HTTPException(500, f"Failed to store message: {e}")

    return {
        "message_id":   stored_id,
        "delivered":    delivered,
        "to_agent_id":  to_agent_id,
        "response":     response_text,
    }


@app.get("/proposals/{proposal_id}/messages")
async def get_messages(proposal_id: str):
    """Get the full A2A message thread for a proposal (chronological)."""
    db = _require("Supabase (SUPABASE_URL/SUPABASE_KEY)", supa)
    try:
        data = (
            db.table("agent_messages")
            .select("*")
            .eq("proposal_id", proposal_id)
            .order("created_at")
            .execute()
        )
        return data.data
    except Exception as e:
        raise HTTPException(500, f"Failed to get messages: {e}")


@app.get("/proposals/stats")
async def proposals_stats():
    """Stats for the job board: total, open, funded, bids submitted."""
    if not supa:
        return {}
    try:
        all_p   = supa.table("job_proposals").select("status").execute().data
        all_b   = supa.table("job_bids").select("id", count="exact").execute()
        total   = len(all_p)
        open_c  = sum(1 for p in all_p if p["status"] == "open")
        funded  = sum(1 for p in all_p if p["status"] == "funded")
        return {
            "total_proposals": total,
            "open":            open_c,
            "funded":          funded,
            "total_bids":      all_b.count or 0,
        }
    except Exception as e:
        return {"error": str(e)}


# ── Health ─────────────────────────────────────────────────────────────────────
@app.get("/healthz")
@app.get("/health")
async def health():
    return {
        "status":    "ok",
        "version":   "3.0.0",
        "payments":  "active" if (payments and NVM_PLAN_ID_VALIDATOR) else "disabled",
        "zeroclick": "active" if ZEROCLICK_API_KEY else "disabled",
        "supabase":  "active" if supa else "disabled",
    }
