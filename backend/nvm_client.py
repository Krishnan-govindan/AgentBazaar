"""
nvm_client.py — Nevermined SDK wrapper for AgentBazaar
=======================================================
Thin async wrapper around payments_py + httpx for common NVM operations:
  • Discover marketplace agents from the Nevermined portal
  • Purchase a plan from another agent (by DID)
  • Call an agent's endpoint with a bearer token

The main FastAPI app (main.py) uses payments_py directly for x402 middleware,
but this module provides clean helper functions for any code that needs to
interact with external Nevermined agents programmatically.

Usage:
    from nvm_client import NVMClient
    client = NVMClient()
    agents = await client.get_marketplace_agents()
    token  = await client.buy_agent_plan("did:nv:abc123")
    result = await client.call_agent("did:nv:abc123", "What do you do?", token)
"""

import os
import logging
from typing import Optional

import httpx
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("agentbazaar.nvm_client")

NVM_API_KEY     = os.environ.get("NVM_API_KEY", "")
NVM_ENVIRONMENT = os.environ.get("NVM_ENVIRONMENT", "sandbox")

# Nevermined service endpoints
_NVM_BASE = {
    "testing": "https://one-backend.testing.nevermined.app",
    "sandbox": "https://one-backend.testing.nevermined.app",
    "production": "https://one-backend.nevermined.app",
}.get(NVM_ENVIRONMENT, "https://one-backend.testing.nevermined.app")

_ABILITY_BROKER_URL = "https://us14.abilityai.dev/api/paid/agentbroker/chat"
_DISCOVER_URL       = "https://nevermined.ai/hackathon/register/api/discover"


class NVMClient:
    """Async Nevermined client for agent discovery, plan purchasing, and agent calls."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or NVM_API_KEY
        if not self.api_key:
            logger.warning("NVMClient: NVM_API_KEY not set — remote calls will fail")

    # ── Agent Discovery ────────────────────────────────────────────────────────

    async def get_marketplace_agents(self) -> list[dict]:
        """Fetch all registered agents from the Nevermined hackathon portal.

        Returns a list of dicts: {did, name, description, endpoint, plan_did, team_name}
        Falls back to the Nevermined backend API if the hackathon portal is unavailable.
        """
        agents: list[dict] = []

        # Primary: hackathon discovery portal
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.get(
                    _DISCOVER_URL,
                    headers={"Authorization": f"Bearer {self.api_key}"} if self.api_key else {},
                )
                if r.status_code == 200:
                    data = r.json()
                    raw  = data if isinstance(data, list) else data.get("agents", data.get("items", []))
                    for item in raw:
                        agents.append({
                            "did":         item.get("did", item.get("agent_did", "")),
                            "name":        item.get("name", item.get("agent_name", "Unknown")),
                            "description": item.get("description", ""),
                            "endpoint":    item.get("endpoint", item.get("url", "")),
                            "plan_did":    item.get("plan_did", item.get("planDid", "")),
                            "team_name":   item.get("team_name", item.get("teamName", "")),
                        })
                    logger.info(f"[NVMClient] Discovered {len(agents)} agents from hackathon portal")
                    return agents
        except Exception as e:
            logger.warning(f"[NVMClient] Hackathon portal unavailable: {e}")

        # Fallback: Nevermined backend API
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.get(
                    f"{_NVM_BASE}/api/v1/agents",
                    headers={"Authorization": f"Bearer {self.api_key}"} if self.api_key else {},
                )
                if r.status_code == 200:
                    data = r.json()
                    raw  = data if isinstance(data, list) else data.get("results", [])
                    for item in raw:
                        agents.append({
                            "did":         item.get("did", ""),
                            "name":        item.get("metadata", {}).get("main", {}).get("name", "Unknown"),
                            "description": item.get("metadata", {}).get("main", {}).get("type", ""),
                            "endpoint":    item.get("serviceEndpoint", ""),
                            "plan_did":    item.get("did", ""),
                            "team_name":   "",
                        })
                    logger.info(f"[NVMClient] Discovered {len(agents)} agents from NVM backend")
        except Exception as e:
            logger.warning(f"[NVMClient] NVM backend unavailable: {e}")

        return agents

    # ── Plan Purchase ──────────────────────────────────────────────────────────

    async def buy_agent_plan(self, did: str) -> str:
        """Purchase the cheapest available plan for an agent by DID.

        Uses the Ability.ai broker as the purchasing mechanism (same as the auto-buy loop).
        Returns an access token string, or the DID itself as a fallback identifier.
        """
        if not self.api_key:
            raise RuntimeError("NVM_API_KEY required to purchase plans")

        # Send a minimal "buy" message via the broker — this triggers the x402 payment flow
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.post(
                    _ABILITY_BROKER_URL,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type":  "application/json",
                    },
                    json={
                        "messages": [{"role": "user", "content": "subscribe"}],
                        "model":    did,
                        "stream":   False,
                    },
                )
                if r.status_code in (200, 201, 402):
                    # 402 means we need to pay — return NVM key as the bearer for subsequent calls
                    logger.info(f"[NVMClient] Plan purchase for {did[:30]}… status={r.status_code}")
                    return self.api_key  # NVM key is the bearer for all purchased plans
                logger.warning(f"[NVMClient] Unexpected status {r.status_code} buying {did}")
        except Exception as e:
            logger.warning(f"[NVMClient] buy_agent_plan failed: {e}")

        # Fallback: return the API key — it acts as bearer for all NVM plans
        return self.api_key

    # ── Agent Call ─────────────────────────────────────────────────────────────

    async def call_agent(self, did: str, message: str, token: Optional[str] = None) -> str:
        """Send a message to an agent identified by DID.

        Resolution order:
          1. Resolve DID → endpoint via Nevermined backend
          2. POST message with bearer token to the resolved endpoint
          3. Fallback to Ability.ai broker if resolution fails

        Returns the agent's text response.
        """
        bearer = token or self.api_key
        endpoint = await self._resolve_endpoint(did)

        if endpoint:
            # Direct call to the agent's endpoint
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    r = await client.post(
                        endpoint,
                        headers={
                            "Authorization": f"Bearer {bearer}",
                            "Content-Type":  "application/json",
                        },
                        json={"query": message, "messages": [{"role": "user", "content": message}]},
                    )
                    if r.status_code == 200:
                        data = r.json()
                        # Handle various response shapes
                        if isinstance(data, str):
                            return data
                        return (
                            data.get("response")
                            or data.get("output")
                            or data.get("result")
                            or data.get("choices", [{}])[0].get("message", {}).get("content", "")
                            or str(data)[:500]
                        )
                    logger.warning(f"[NVMClient] Direct call returned {r.status_code}")
            except Exception as e:
                logger.warning(f"[NVMClient] Direct call to {endpoint} failed: {e}")

        # Fallback: broker-mediated call
        logger.info(f"[NVMClient] Falling back to broker for {did[:30]}…")
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.post(
                    _ABILITY_BROKER_URL,
                    headers={
                        "Authorization": f"Bearer {bearer}",
                        "Content-Type":  "application/json",
                    },
                    json={
                        "messages": [{"role": "user", "content": message}],
                        "model":    did,
                        "stream":   False,
                    },
                )
                if r.status_code == 200:
                    data = r.json()
                    choices = data.get("choices", [])
                    if choices:
                        return choices[0].get("message", {}).get("content", str(data)[:500])
                    return str(data)[:500]
                return f"[broker status {r.status_code}]"
        except Exception as e:
            return f"[call_agent error: {e}]"

    # ── Internal ───────────────────────────────────────────────────────────────

    async def _resolve_endpoint(self, did: str) -> Optional[str]:
        """Resolve a DID to its service endpoint URL."""
        if did.startswith("http"):
            return did  # already a URL
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    f"{_NVM_BASE}/api/v1/agents/{did}",
                    headers={"Authorization": f"Bearer {self.api_key}"} if self.api_key else {},
                )
                if r.status_code == 200:
                    data = r.json()
                    return data.get("serviceEndpoint") or data.get("endpoint") or data.get("url")
        except Exception:
            pass
        return None


# ── Module-level convenience instance ──────────────────────────────────────────
_default_client: Optional[NVMClient] = None


def get_client() -> NVMClient:
    """Return (or lazily create) the module-level NVMClient instance."""
    global _default_client
    if _default_client is None:
        _default_client = NVMClient()
    return _default_client


# ── Agent registration helper (used at deploy time) ────────────────────────────
async def register_agent(endpoint_url: str) -> dict:
    """Register AgentBazaar as a paid service on Nevermined.

    Called once after deployment:
        python -c "import asyncio; from nvm_client import register_agent; asyncio.run(register_agent('RAILWAY_URL'))"
    """
    from payments_py import Payments, PaymentOptions

    if not NVM_API_KEY:
        raise RuntimeError("NVM_API_KEY required")

    p = Payments.get_instance(PaymentOptions(nvm_api_key=NVM_API_KEY, environment=NVM_ENVIRONMENT))

    result = p.create_service_plan(
        name="Agent Bazaar API",
        description="Browse, validate and talk to any Nevermined marketplace agent",
        price=5,          # 5 NVM = ~$0.05/call
        token_address="0x",
        amount_of_credits=50,
        tags=["marketplace", "validator", "agent-discovery"],
    )
    logger.info(f"[register_agent] Plan created: {result}")

    # Register the endpoint for the plan
    plan_did = result.get("did") or result.get("plan_did")
    if plan_did:
        svc_result = p.create_service(
            plan_did=plan_did,
            service_type="agent",
            name="Agent Bazaar Intelligence",
            description="POST /api/ask — browse, validate, talk, recommend agents",
            charge_type="fixed",
            amount_of_credits=1,
            endpoints=[{"POST": f"{endpoint_url}/chat"}],
            open_endpoints=[f"{endpoint_url}/healthz"],
        )
        logger.info(f"[register_agent] Service registered: {svc_result}")
        return {"plan": result, "service": svc_result}

    return {"plan": result}
