"""
register_agents.py — Register ONE combined AgentBazaar agent on Nevermined
===========================================================================
Run ONCE after deploying to Railway. A single agent + plan covers all services:
  - POST /validate  (Agent Validator — 1 credit/call)
  - POST /research  (Market Research — 1 credit/call)
  - GET  /agents    (Agent Directory — free)

Other teams only need ONE plan ID to buy from AgentBazaar.

Usage:
    export NVM_API_KEY=sandbox:your-key
    export BACKEND_URL=https://your-app.up.railway.app
    python register_agents.py

Output (copy to Railway > Settings > Variables):
    NVM_PLAN_ID=<plan-id>
    NVM_AGENT_ID=<agent-id>
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


def register_combined():
    print(f"\n{'='*60}")
    print(f"  AgentBazaar — Single Combined Agent Registration")
    print(f"  Backend: {BACKEND_URL}")
    print(f"  Environment: {NVM_ENVIRONMENT}")
    print(f"{'='*60}\n")

    payments = Payments.get_instance(
        PaymentOptions(nvm_api_key=NVM_API_KEY, environment=NVM_ENVIRONMENT)
    )

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
    }

    agent_api = {
        "endpoints": [
            {"POST": f"{BACKEND_URL}/validate"},
            {"POST": f"{BACKEND_URL}/research"},
            {"GET":  f"{BACKEND_URL}/agents"},
            {"GET":  f"{BACKEND_URL}/marketplace/directory"},
            {"POST": f"{BACKEND_URL}/marketplace/buy"},
        ],
        "agentDefinitionUrl": f"{BACKEND_URL}/openapi.json",
    }

    plan_metadata = {
        "name": "AgentBazaar — Combined Pay-per-Use Plan",
        "description": (
            "Access all AgentBazaar services under one plan. "
            "100 credits included at $0.25 USDC. "
            "1 credit per validate or research call. Directory browsing is free."
        ),
        "dateCreated": DATE_CREATED,
    }

    # $0.25 USDC = 250_000 micro-USDC (6 decimals), 100 credits, 1 credit per call
    price_config   = get_erc20_price_config(250_000, USDC_ADDRESS, BUILDER_ADDRESS)
    credits_config = get_fixed_credits_config(100, 1)

    try:
        agent_info = payments.agents.register_agent_and_plan(
            agent_metadata,
            agent_api,
            plan_metadata,
            price_config,
            credits_config,
            "credits",
        )

        agent_id = agent_info["agentId"]
        plan_id  = agent_info["planId"]

        print(f"  ✅  Agent ID : {agent_id}")
        print(f"  ✅  Plan ID  : {plan_id}")
        print(f"  🌐  View at  : https://nevermined.app/en/agents/{agent_id}")

        print(f"\n{'='*60}")
        print("  COPY THESE TO Railway > Settings > Variables")
        print(f"{'='*60}\n")
        print(f"NVM_PLAN_ID={plan_id}")
        print(f"NVM_AGENT_ID={agent_id}")
        print()
        print(f"{'='*60}")
        print(f"  Also set:  BACKEND_URL={BACKEND_URL}")
        print(f"{'='*60}\n")

    except Exception as e:
        print(f"  ❌  Registration failed: {e}")
        raise


if __name__ == "__main__":
    register_combined()
