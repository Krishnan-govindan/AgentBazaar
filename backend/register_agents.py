"""
register_agents.py — Register all 3 AgentBazaar services on Nevermined
=======================================================================
Run ONCE after deploying to Railway. Each service gets its own agent DID
and payment plan. Copy the output IDs into Railway environment variables.

Usage:
    export NVM_API_KEY=sandbox:your-key
    export BACKEND_URL=https://your-app.up.railway.app
    python register_agents.py

Output:
    PLAN_ID_VALIDATOR=did:nv:xxx
    PLAN_ID_RESEARCH=did:nv:xxx
    AGENT_ID_VALIDATOR=did:nv:xxx
    AGENT_ID_RESEARCH=did:nv:xxx
    AGENT_ID_DIRECTORY=did:nv:xxx
"""

import os
import time
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

# ── Services to register ───────────────────────────────────────────────────────
SERVICES = [
    {
        "env_prefix":         "VALIDATOR",
        "name":               "AgentBazaar — Agent Validator",
        "description":        (
            "Score any AI agent proposal 0-100 using Claude AI + Apify web scraping + "
            "Exa semantic search. Returns a structured scorecard with badge tier, "
            "5 dimension scores, risk flags, and ZeroClick sponsored insights."
        ),
        "tags":               ["validation", "scoring", "ai-agents", "apify", "exa", "claude"],
        "method":             "POST",
        "endpoint":           f"{BACKEND_URL}/validate",
        "price_usdc":         250_000,   # $0.25 (USDC has 6 decimals)
        "credits":            100,
        "credits_per_request": 1,
    },
    {
        "env_prefix":         "RESEARCH",
        "name":               "AgentBazaar — Market Research",
        "description":        (
            "Instant AI-powered market research brief on any topic. "
            "Uses Exa deep search (3 query variations) + Claude synthesis for "
            "executive summaries, key findings, and market data. "
            "Includes ZeroClick sponsored commercial context."
        ),
        "tags":               ["research", "market-analysis", "exa", "claude", "intelligence"],
        "method":             "POST",
        "endpoint":           f"{BACKEND_URL}/research",
        "price_usdc":         500_000,   # $0.50
        "credits":            100,
        "credits_per_request": 1,
    },
    {
        "env_prefix":         "DIRECTORY",
        "name":               "AgentBazaar — Agent Directory",
        "description":        (
            "Browse all registered AI agents in the AgentBazaar marketplace. "
            "Returns agent names, capabilities, pricing, endpoints, and plan DIDs. "
            "Free to access — no credits required."
        ),
        "tags":               ["directory", "discovery", "agents", "marketplace", "free"],
        "method":             "GET",
        "endpoint":           f"{BACKEND_URL}/agents",
        "price_usdc":         0,
        "credits":            10_000,
        "credits_per_request": 0,
    },
]


def register_all():
    print(f"\n{'='*60}")
    print(f"  AgentBazaar — Nevermined Agent Registration")
    print(f"  Backend: {BACKEND_URL}")
    print(f"  Environment: {NVM_ENVIRONMENT}")
    print(f"{'='*60}\n")

    payments = Payments.get_instance(
        PaymentOptions(nvm_api_key=NVM_API_KEY, environment=NVM_ENVIRONMENT)
    )

    results: dict[str, dict] = {}

    for svc in SERVICES:
        print(f"\n{'─'*50}")
        print(f"  Registering: {svc['name']}")
        print(f"{'─'*50}")

        agent_metadata = {
            "name":        svc["name"],
            "description": svc["description"],
            "tags":        svc["tags"],
            "dateCreated": DATE_CREATED,
        }

        agent_api = {
            "endpoints":           [{svc["method"]: svc["endpoint"]}],
            "agentDefinitionUrl":  f"{BACKEND_URL}/openapi.json",
        }

        plan_metadata = {
            "name":        f"{svc['name']} — Pay-per-Use Plan",
            "description": (
                f"Access to {svc['name']}. "
                f"{svc['credits']} credits included. "
                f"{'Free access.' if svc['price_usdc'] == 0 else f'${svc[\"price_usdc\"]/1_000_000:.2f} USDC per {svc[\"credits\"]} credits.'}"
            ),
            "dateCreated": DATE_CREATED,
        }

        price_config   = get_erc20_price_config(svc["price_usdc"], USDC_ADDRESS, BUILDER_ADDRESS)
        credits_config = get_fixed_credits_config(svc["credits"], max(svc["credits_per_request"], 1))

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

            results[svc["env_prefix"]] = {"agent_id": agent_id, "plan_id": plan_id}

            print(f"  ✅  Agent ID : {agent_id}")
            print(f"  ✅  Plan ID  : {plan_id}")
            print(f"  🌐  View at  : https://nevermined.app/en/agents/{agent_id}")

        except Exception as e:
            print(f"  ❌  Failed: {e}")
            results[svc["env_prefix"]] = {"error": str(e)}

    # ── Print summary ────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print("  SUMMARY — copy these to Railway > Settings > Variables")
    print(f"{'='*60}\n")

    for prefix, info in results.items():
        if "error" not in info:
            print(f"PLAN_ID_{prefix}={info['plan_id']}")
            print(f"AGENT_ID_{prefix}={info['agent_id']}")
            print()

    print(f"{'='*60}")
    print("  Also set:")
    print(f"  BACKEND_URL={BACKEND_URL}")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    register_all()
