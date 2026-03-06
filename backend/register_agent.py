"""
register_agent.py — One-time Nevermined agent + payment plan registration
=========================================================================
Run this ONCE before deploying. It creates the agent and plan on Nevermined
sandbox and prints the IDs you need to add to your Railway environment variables.

Usage:
    pip install "payments-py[fastapi]" python-dotenv
    python register_agent.py
"""

import os
from dotenv import load_dotenv
from payments_py import Payments, PaymentOptions
from payments_py.plans import get_erc20_price_config, get_fixed_credits_config

load_dotenv()

NVM_API_KEY = os.environ["NVM_API_KEY"]
NVM_ENVIRONMENT = os.environ.get("NVM_ENVIRONMENT", "sandbox")
BUILDER_ADDRESS = os.environ.get("BUILDER_ADDRESS", "0x0000000000000000000000000000000000000000")

# USDC contract on Base Sepolia (sandbox)
USDC_ADDRESS_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"

# Your deployed backend URL — update this after Railway deploy
BACKEND_URL = os.environ.get("BACKEND_URL", "https://your-app.up.railway.app")


def main():
    print(f"Connecting to Nevermined ({NVM_ENVIRONMENT})...")

    payments = Payments.get_instance(
        PaymentOptions(
            nvm_api_key=NVM_API_KEY,
            environment=NVM_ENVIRONMENT,
        )
    )

    agent_metadata = {
        "name": "AI Agent Capability Validator",
        "description": (
            "Validates and scores AI agent capabilities using web scraping, "
            "semantic search, and Claude AI evaluation. Returns a structured "
            "scorecard with badge tier, dimension scores, and risk flags."
        ),
        "tags": ["validation", "scoring", "ai-agents", "hackathon"],
        "dateCreated": "2026-03-05T00:00:00Z",
    }

    agent_api = {
        "endpoints": [{"POST": f"{BACKEND_URL}/validate"}],
        "agentDefinitionUrl": f"{BACKEND_URL}/openapi.json",
    }

    plan_metadata = {
        "name": "AgentBazaar Validator Credits",
        "description": "1 credit per validation request. 100 credits included.",
        "dateCreated": "2026-03-05T00:00:00Z",
    }

    # 10 USDC (6 decimals) for 100 credits
    price_config = get_erc20_price_config(
        10_000_000,
        USDC_ADDRESS_BASE_SEPOLIA,
        BUILDER_ADDRESS,
    )

    # 100 credits total, 1 burned per request
    credits_config = get_fixed_credits_config(100, 1)

    print("Registering agent and payment plan...")

    agent_info = payments.agents.register_agent_and_plan(
        agent_metadata=agent_metadata,
        agent_api=agent_api,
        plan_metadata=plan_metadata,
        price_config=price_config,
        credits_config=credits_config,
        access_limit="credits",
    )

    plan_id = agent_info["planId"]
    agent_id = agent_info["agentId"]

    print("\n✅ Registration successful!")
    print("=" * 60)
    print("Add these to your Railway environment variables:")
    print(f"  NVM_PLAN_ID={plan_id}")
    print(f"  NVM_AGENT_ID={agent_id}")
    print("=" * 60)
    print(f"\nYour agent is live at: nevermined.app/en/agents/{agent_id}")


if __name__ == "__main__":
    main()
