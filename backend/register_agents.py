"""
register_agents.py — Register all AgentBazaar agents on Nevermined
===================================================================
Run ONCE after deploying to Railway. Registers:
  1. Combined core agent (validate + research + directory)
  2. Future Proposals agent ($1.00/call)
  3. Marketing/Promotions agent ($0.75/call)

Usage:
    export NVM_API_KEY=sandbox:your-key
    export BACKEND_URL=https://your-app.up.railway.app
    python register_agents.py

Output (copy to Railway > Settings > Variables):
    NVM_PLAN_ID=<plan-id>
    NVM_AGENT_ID=<agent-id>
    NVM_PLAN_ID_FUTURE=<plan-id>
    NVM_AGENT_ID_FUTURE=<agent-id>
    NVM_PLAN_ID_PROMOTE=<plan-id>
    NVM_AGENT_ID_PROMOTE=<agent-id>
"""

import os
from dotenv import load_dotenv

load_dotenv()

from payments_py import Payments, PaymentOptions
from payments_py.plans import get_erc20_price_config, get_fixed_credits_config

# ── Config ─────────────────────────────────────────────────────────────────────
NVM_API_KEY     = os.environ["NVM_API_KEY"]
NVM_ENVIRONMENT = os.environ.get("NVM_ENVIRONMENT", "sandbox")
BACKEND_URL     = os.environ.get("BACKEND_URL", "http://localhost:8000")
BUILDER_ADDRESS = os.environ.get("BUILDER_ADDRESS", "0x0000000000000000000000000000000000000000")

# USDC on Base Sepolia (sandbox)
USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"

DATE_CREATED = "2026-03-06T00:00:00Z"


def register_combined(payments):
    """Register core AgentBazaar marketplace agent ($0.25/call)."""
    print(f"\n{'='*60}")
    print("  [1/3] AgentBazaar Core Marketplace Agent")
    print(f"  Backend: {BACKEND_URL}")
    print(f"{'='*60}")

    agent_metadata = {
        "name": "AgentBazaar — AI Agent Marketplace",
        "description": (
            "Full AI agent marketplace in one plan: "
            "validate any agent 0-100 (Claude AI + Apify web scraping + Exa semantic search), "
            "run AI-powered market research (Exa 3-query variations + Claude synthesis), "
            "and browse the live agent directory. "
            "Every paid response includes ZeroClick AI-native sponsored context. "
            "ABTS trust scores, star ratings, and cross-team A2A buying included."
        ),
        "tags": [
            "marketplace", "validation", "research", "directory",
            "ai-agents", "apify", "exa", "claude", "zeroclick", "abts",
        ],
        "dateCreated": DATE_CREATED,
        "author": "AgentBazaar",
        "license": "Apache-2.0",
        "version": "3.2.0",
    }

    agent_api = {
        "endpoints": [
            {"POST": f"{BACKEND_URL}/validate"},
            {"POST": f"{BACKEND_URL}/research"},
            {"GET":  f"{BACKEND_URL}/agents"},
            {"GET":  f"{BACKEND_URL}/marketplace/directory"},
            {"POST": f"{BACKEND_URL}/marketplace/buy"},
            {"GET":  f"{BACKEND_URL}/marketplace/abts-leaderboard"},
            {"POST": f"{BACKEND_URL}/marketplace/matches"},
            {"GET":  f"{BACKEND_URL}/api/ads/match"},
            {"POST": f"{BACKEND_URL}/api/ads/register"},
        ],
        "agentDefinitionUrl": f"{BACKEND_URL}/openapi.json",
    }

    plan_metadata = {
        "name": "AgentBazaar — Combined Pay-per-Use Plan",
        "description": (
            "Access all AgentBazaar core services under one plan. "
            "100 credits included at $0.25 USDC. "
            "1 credit per validate or research call. Directory and ads are free."
        ),
        "dateCreated": DATE_CREATED,
        "tags": ["marketplace", "validation", "research", "zeroclick"],
    }

    # $0.25 USDC = 250_000 micro-USDC (6 decimals), 100 credits, 1 credit per call
    price_config   = get_erc20_price_config(250_000, USDC_ADDRESS, BUILDER_ADDRESS)
    credits_config = get_fixed_credits_config(100, 1)

    agent_info = payments.agents.register_agent_and_plan(
        agent_metadata,
        agent_api,
        plan_metadata,
        price_config,
        credits_config,
        "credits",
    )
    return agent_info["agentId"], agent_info["planId"]


def register_future_proposals(payments):
    """Register Future Proposals agent ($1.00/call — premium commitment service)."""
    print(f"\n{'='*60}")
    print("  [2/3] AgentBazaar Future Proposals Agent")
    print(f"{'='*60}")

    agent_metadata = {
        "name": "AgentBazaar Future Proposals",
        "description": (
            "Commit AI agents to build future capabilities — with negotiation support, "
            "pricing locks, and ZeroClick-enriched incentive context on every proposal. "
            "Post a future proposal to any hackathon agent and let them negotiate timeline "
            "and price. All accepted proposals are logged as cross-team transactions. "
            "Includes mass outreach to all Nevermined hackathon agents via /proposals/future/outreach."
        ),
        "tags": [
            "proposals", "future", "negotiate", "commitment", "roadmap",
            "ai-agent", "zeroclick", "outreach", "discovery",
        ],
        "dateCreated": DATE_CREATED,
        "author": "AgentBazaar",
        "license": "Apache-2.0",
        "version": "1.0.0",
    }

    agent_api = {
        "endpoints": [
            {"POST": f"{BACKEND_URL}/proposals/future"},
            {"GET":  f"{BACKEND_URL}/proposals/future"},
            {"POST": f"{BACKEND_URL}/proposals/future/outreach"},
            {"POST": f"{BACKEND_URL}/proposals/future/{{proposal_id}}/negotiate"},
            {"POST": f"{BACKEND_URL}/proposals/future/{{proposal_id}}/accept"},
        ],
        "agentDefinitionUrl": f"{BACKEND_URL}/openapi.json",
    }

    plan_metadata = {
        "name": "AgentBazaar Future Proposals Plan",
        "description": (
            "Pay per future proposal creation. "
            "100 credits at $1.00 USDC — 1 credit per call. "
            "Each proposal comes with ZeroClick-enriched incentive context "
            "to make your offer attractive to other agents."
        ),
        "dateCreated": DATE_CREATED,
        "tags": ["future", "proposals", "negotiate", "zeroclick"],
    }

    # $1.00 USDC = 1_000_000 micro-USDC, 100 credits, 1 credit per call
    price_config   = get_erc20_price_config(1_000_000, USDC_ADDRESS, BUILDER_ADDRESS)
    credits_config = get_fixed_credits_config(100, 1)

    agent_info = payments.agents.register_agent_and_plan(
        agent_metadata,
        agent_api,
        plan_metadata,
        price_config,
        credits_config,
        "credits",
    )
    return agent_info["agentId"], agent_info["planId"]


def register_promotions(payments):
    """Register Marketing/Promotions agent ($0.75/call — ZeroClick + Exa/X social discovery)."""
    print(f"\n{'='*60}")
    print("  [3/3] AgentBazaar Marketing & Promotions Agent")
    print(f"{'='*60}")

    agent_metadata = {
        "name": "AgentBazaar Promotions",
        "description": (
            "Promote your AI agent service across the entire hackathon network. "
            "ZeroClick-powered ad placement on every matched query, "
            "social discovery via Exa search of X/Twitter conversations, "
            "and cross-agent ad distribution (buys placement on 3 discovered agents per call). "
            "Get your service in front of every buyer and agent in the Nevermined ecosystem. "
            "Includes promotion analytics via /promote/stats."
        ),
        "tags": [
            "marketing", "promote", "zeroclick", "ads", "visibility",
            "discovery", "twitter", "social", "x", "exa",
        ],
        "dateCreated": DATE_CREATED,
        "author": "AgentBazaar",
        "license": "Apache-2.0",
        "version": "1.0.0",
    }

    agent_api = {
        "endpoints": [
            {"POST": f"{BACKEND_URL}/promote"},
            {"GET":  f"{BACKEND_URL}/promote/stats"},
            {"GET":  f"{BACKEND_URL}/api/ads/stats"},
            {"GET":  f"{BACKEND_URL}/api/ads/match"},
        ],
        "agentDefinitionUrl": f"{BACKEND_URL}/openapi.json",
    }

    plan_metadata = {
        "name": "AgentBazaar Promotions Plan",
        "description": (
            "AI-native marketing for agents — $0.75 USDC per promotion. "
            "100 credits included. ZeroClick ad distribution + Exa/X social insights "
            "+ cross-agent ad placement in one call."
        ),
        "dateCreated": DATE_CREATED,
        "tags": ["marketing", "ads", "promotion", "zeroclick", "social"],
    }

    # $0.75 USDC = 750_000 micro-USDC, 100 credits, 1 credit per call
    price_config   = get_erc20_price_config(750_000, USDC_ADDRESS, BUILDER_ADDRESS)
    credits_config = get_fixed_credits_config(100, 1)

    agent_info = payments.agents.register_agent_and_plan(
        agent_metadata,
        agent_api,
        plan_metadata,
        price_config,
        credits_config,
        "credits",
    )
    return agent_info["agentId"], agent_info["planId"]


if __name__ == "__main__":
    print(f"\n{'='*60}")
    print("  AgentBazaar — Full Agent Registration v3.2.0")
    print(f"  Environment: {NVM_ENVIRONMENT}")
    print(f"  Backend:     {BACKEND_URL}")
    print(f"{'='*60}")

    payments = Payments.get_instance(
        PaymentOptions(nvm_api_key=NVM_API_KEY, environment=NVM_ENVIRONMENT)
    )

    results = {}

    # 1. Core marketplace agent
    try:
        agent_id, plan_id = register_combined(payments)
        results["core"] = (agent_id, plan_id)
        print(f"  ✅  Agent ID : {agent_id}")
        print(f"  ✅  Plan ID  : {plan_id}")
        print(f"  🌐  View at  : https://nevermined.app/en/agents/{agent_id}")
    except Exception as e:
        print(f"  ❌  Core agent failed: {e}")
        results["core"] = None

    # 2. Future Proposals agent
    try:
        agent_id_f, plan_id_f = register_future_proposals(payments)
        results["future"] = (agent_id_f, plan_id_f)
        print(f"  ✅  Agent ID : {agent_id_f}")
        print(f"  ✅  Plan ID  : {plan_id_f}")
        print(f"  🌐  View at  : https://nevermined.app/en/agents/{agent_id_f}")
    except Exception as e:
        print(f"  ❌  Future proposals agent failed: {e}")
        results["future"] = None

    # 3. Marketing/Promotions agent
    try:
        agent_id_p, plan_id_p = register_promotions(payments)
        results["promote"] = (agent_id_p, plan_id_p)
        print(f"  ✅  Agent ID : {agent_id_p}")
        print(f"  ✅  Plan ID  : {plan_id_p}")
        print(f"  🌐  View at  : https://nevermined.app/en/agents/{agent_id_p}")
    except Exception as e:
        print(f"  ❌  Promotions agent failed: {e}")
        results["promote"] = None

    # Print all env vars to copy
    print(f"\n{'='*60}")
    print("  COPY THESE TO Railway > Settings > Variables")
    print(f"{'='*60}\n")

    if results.get("core"):
        print(f"NVM_PLAN_ID={results['core'][1]}")
        print(f"NVM_AGENT_ID={results['core'][0]}")
        print(f"NVM_PLAN_ID_VALIDATOR={results['core'][1]}")
        print(f"NVM_AGENT_ID_VALIDATOR={results['core'][0]}")
        print(f"NVM_PLAN_ID_RESEARCH={results['core'][1]}")
        print(f"NVM_AGENT_ID_RESEARCH={results['core'][0]}")
    else:
        print("# Core agent registration failed — set NVM_PLAN_ID manually")

    if results.get("future"):
        print(f"NVM_PLAN_ID_FUTURE={results['future'][1]}")
        print(f"NVM_AGENT_ID_FUTURE={results['future'][0]}")
    else:
        print("# Future proposals agent registration failed — set NVM_PLAN_ID_FUTURE manually")

    if results.get("promote"):
        print(f"NVM_PLAN_ID_PROMOTE={results['promote'][1]}")
        print(f"NVM_AGENT_ID_PROMOTE={results['promote'][0]}")
    else:
        print("# Promotions agent registration failed — set NVM_PLAN_ID_PROMOTE manually")

    print()
    print(f"BACKEND_URL={BACKEND_URL}")
    print(f"\n{'='*60}\n")
