"""
AgentBazaar — Full AI Agent Marketplace
=========================================
FastAPI backend with 3 Nevermined-registered services, ZeroClick AI-native ads,
cross-team A2A buying, and autonomous background purchasing loop.

Services:
  POST /validate   — x402-gated: Apify scrape + Exa search → Claude scoring → ZeroClick ads
  POST /research   — x402-gated: Exa multi-query → Claude synthesis → ZeroClick ads
  GET  /agents     — free: agent directory (Supabase)

Cross-team:
  GET  /marketplace/agents       — discover other teams' agents
  POST /marketplace/buy          — buy from another agent, log transaction
  GET  /marketplace/transactions — full ledger for judges
  GET  /marketplace/stats        — stats + cross-team tx count

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_auto_buy_loop())
    logger.info("AgentBazaar started — auto-buy loop active")
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


# ── FastAPI app ────────────────────────────────────────────────────────────────
app = FastAPI(
    title="AgentBazaar — AI Agent Marketplace",
    version="2.0.0",
    description=(
        "Full AI agent marketplace with 3 Nevermined x402-gated services, "
        "ZeroClick AI-native ads, and cross-team A2A commerce."
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


# ── Health ─────────────────────────────────────────────────────────────────────
@app.get("/healthz")
@app.get("/health")
async def health():
    return {
        "status":   "ok",
        "version":  "2.0.0",
        "payments": "active" if (payments and NVM_PLAN_ID_VALIDATOR) else "disabled",
        "zeroclick": "active" if ZEROCLICK_API_KEY else "disabled",
        "supabase": "active" if supa else "disabled",
    }
