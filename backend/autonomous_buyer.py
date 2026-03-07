"""
autonomous_buyer.py — AgentBazaar Autonomous Buyer
===================================================
Discovers ALL Nevermined hackathon agents and calls them with proper x402 auth.

Hackathon scoring multipliers this unlocks:
  Plans bought:          ×4
  API calls made:        ×4
  Unique counterparties: ×3 (cap 20)

Usage (standalone):
    python backend/autonomous_buyer.py

Usage (as module in main.py):
    from autonomous_buyer import AutonomousBuyer
    buyer = AutonomousBuyer(payments, supa)
    await buyer.run_once()
"""

import os
import json
import asyncio
import logging

import httpx
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("autonomous_buyer")

# ── Config ─────────────────────────────────────────────────────────────────────
NVM_API_KEY     = os.environ.get("NVM_API_KEY", "")
NVM_ENVIRONMENT = os.environ.get("NVM_ENVIRONMENT", "sandbox")
SUPABASE_URL    = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY    = os.environ.get("SUPABASE_KEY", "")

# Nevermined hackathon discovery endpoint
DISCOVER_URL = "https://nevermined.ai/hackathon/register/api/discover"

# Nevermined node REST API for paginating ALL plans
# Sandbox node:  https://node.testing.nevermined.app
# Mainnet node:  https://node.nevermined.app
NVM_NODE_URL = (
    "https://node.testing.nevermined.app"
    if "sandbox" in NVM_ENVIRONMENT.lower()
    else "https://node.nevermined.app"
)

# ── Known agents from hackathon contacts ──────────────────────────────────────
# Add newly discovered agents here for guaranteed calls each cycle
KNOWN_AGENTS = [
    {
        "name": "Research Agent (hackathon team)",
        "plan_id": "9168834408799679719145079291439703578843086640569012876812947119908077187627",
        "agent_id": "8878022156834982848061335566292396075562205972977571007032062516226650252439",
        "url": "https://nevermined-hack-production.up.railway.app",
        "calls": [
            {
                "method": "POST",
                "path": "/search",
                "payload": {"query": "autonomous AI agents marketplace economics 2026"},
                "label": "arXiv-search",
            },
            {
                "method": "POST",
                "path": "/summarize",
                "payload": {"text": "Nevermined x402 payment protocol enables autonomous agent commerce"},
                "label": "gemini-summarize",
            },
        ],
    },
]

# Research topics cycled for variety
RESEARCH_TOPICS = [
    "AI agent marketplace economic model 2026",
    "Nevermined x402 payment protocol adoption",
    "autonomous agent monetization strategies",
    "ZeroClick AI native advertising market",
    "decentralized AI agent economies",
    "multi-agent orchestration frameworks",
    "agent-to-agent payment protocols",
    "AI agent trust and verification systems",
]

# Generic endpoint patterns to try on discovered agents
GENERIC_CALL_PATTERNS = [
    {"method": "POST", "path": "/research",   "payload": lambda t: {"topic": t, "depth": "brief"}},
    {"method": "POST", "path": "/search",     "payload": lambda t: {"query": t}},
    {"method": "POST", "path": "/chat",       "payload": lambda t: {"message": f"Tell me about {t}"}},
    {"method": "POST", "path": "/v1/chat/completions", "payload": lambda t: {
        "messages": [{"role": "user", "content": f"Tell me about {t}"}],
        "model": "gpt-3.5-turbo",
    }},
    {"method": "GET",  "path": "/health",     "payload": lambda t: None},
    {"method": "GET",  "path": "/healthz",    "payload": lambda t: None},
]


class AutonomousBuyer:
    """
    Discovers hackathon agents and calls them via x402-authenticated requests.
    Can be used as a standalone script or embedded in the FastAPI lifespan loop.
    """

    def __init__(self, payments=None, supabase=None):
        self.payments = payments
        self.supa = supabase
        self._topic_idx = 0
        self._agent_idx = 0
        self._purchased_plans: set[str] = set()   # avoid re-ordering same plan
        self._called_agents: set[str]   = set()   # track unique counterparties

    # ── Discovery ──────────────────────────────────────────────────────────────

    async def _discover_hackathon_agents(self) -> list[dict]:
        """Pull seller agents from the Nevermined hackathon registry."""
        agents: list[dict] = []
        try:
            async with httpx.AsyncClient(timeout=15) as c:
                r = await c.get(
                    DISCOVER_URL,
                    params={"side": "sell"},
                    headers={
                        "x-nvm-api-key": NVM_API_KEY,
                        "Authorization": f"Bearer {NVM_API_KEY}",
                    },
                )
            if r.status_code == 200:
                sellers = r.json().get("sellers", [])
                logger.info(f"[buyer] Discovery API returned {len(sellers)} sellers")
                for s in sellers:
                    team = s.get("teamName", "")
                    if team == "Agent Bazaar":
                        continue  # skip ourselves
                    endpoint = (
                        s.get("endpointUrl")
                        or s.get("endpoint")
                        or s.get("serviceEndpoint")
                        or ""
                    )
                    plan_id = str(
                        s.get("nvmPlanId")
                        or s.get("planId")
                        or s.get("plan_id")
                        or ""
                    )
                    name = s.get("name") or team or "unknown"
                    if endpoint or plan_id:
                        agents.append({
                            "name":    name,
                            "plan_id": plan_id,
                            "url":     endpoint,
                            "team":    team,
                            "source":  "discovery-api",
                        })
            else:
                logger.warning(f"[buyer] Discovery API returned {r.status_code}: {r.text[:200]}")
        except Exception as e:
            logger.warning(f"[buyer] Discovery API failed: {e}")
        return agents

    async def _paginate_nvm_plans(self) -> list[dict]:
        """
        Paginate through all plans on the Nevermined node REST API.
        Adds unique agents not found via the hackathon discovery API.
        """
        agents: list[dict] = []
        try:
            page = 0
            per_page = 20
            while True:
                async with httpx.AsyncClient(timeout=15) as c:
                    r = await c.get(
                        f"{NVM_NODE_URL}/api/v1/payments/plans",
                        params={"page": page, "limit": per_page, "status": "active"},
                        headers={"Authorization": f"Bearer {NVM_API_KEY}"},
                    )
                if r.status_code != 200:
                    break
                data = r.json()
                items = data if isinstance(data, list) else data.get("plans", data.get("results", []))
                if not items:
                    break

                for plan in items:
                    plan_id = str(plan.get("did") or plan.get("planId") or plan.get("id") or "")
                    name    = plan.get("name") or plan.get("title") or plan_id[:20]
                    # Try to get agent endpoints for this plan
                    endpoints = await self._get_plan_agents(plan_id)
                    for ep in endpoints:
                        agents.append({
                            "name":    f"{name} (plan agent)",
                            "plan_id": plan_id,
                            "url":     ep,
                            "team":    plan.get("author", "unknown"),
                            "source":  "plan-pagination",
                        })

                if len(items) < per_page:
                    break
                page += 1
                if page > 10:  # safety cap — max 200 plans
                    break

        except Exception as e:
            logger.debug(f"[buyer] NVM plan pagination failed (expected if no node access): {e}")
        return agents

    async def _get_plan_agents(self, plan_id: str) -> list[str]:
        """Get agent endpoint URLs registered under a given plan."""
        if not plan_id:
            return []
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.get(
                    f"{NVM_NODE_URL}/api/v1/payments/plans/{plan_id}/agents",
                    headers={"Authorization": f"Bearer {NVM_API_KEY}"},
                )
            if r.status_code == 200:
                data = r.json()
                urls = []
                for ag in (data if isinstance(data, list) else data.get("agents", [])):
                    url = ag.get("serviceEndpoint") or ag.get("url") or ag.get("endpoint") or ""
                    if url:
                        urls.append(url)
                return urls
        except Exception:
            pass
        return []

    # ── x402 token management ──────────────────────────────────────────────────

    def _get_token(self, plan_id: str) -> str:
        """Get an x402 access token for a plan (order it first if needed)."""
        if not self.payments or not plan_id:
            return ""
        # Order plan if not yet purchased
        if plan_id not in self._purchased_plans:
            try:
                self.payments.plans.order_plan(plan_id=plan_id)
                self._purchased_plans.add(plan_id)
                logger.info(f"[buyer] Ordered plan {plan_id[:20]}…")
            except Exception as e:
                logger.debug(f"[buyer] order_plan failed for {plan_id[:20]}: {e}")
                # Plan may already be ordered — try to get token anyway
        try:
            tok = self.payments.x402.get_x402_access_token(plan_id=plan_id)
            token = tok.get("accessToken", "") if tok else ""
            if token:
                self._purchased_plans.add(plan_id)
            return token
        except Exception as e:
            logger.debug(f"[buyer] get_x402_access_token failed for {plan_id[:20]}: {e}")
            return ""

    # ── Calling agents ─────────────────────────────────────────────────────────

    async def _call_endpoint(
        self,
        name: str,
        url: str,
        method: str,
        path: str,
        payload,
        token: str,
        label: str = "",
    ) -> tuple[int, dict]:
        """Make one HTTP call to an agent endpoint, return (status, response_body)."""
        full_url = url.rstrip("/") + "/" + path.lstrip("/")
        headers: dict = {"Content-Type": "application/json"}
        if token:
            headers["payment-signature"] = token
        if NVM_API_KEY:
            headers["Authorization"] = f"Bearer {NVM_API_KEY}"
            headers["x-nvm-api-key"] = NVM_API_KEY

        try:
            async with httpx.AsyncClient(timeout=25, verify=False) as c:
                if method.upper() == "GET":
                    r = await c.get(full_url, headers=headers)
                else:
                    r = await c.post(full_url, headers=headers, json=payload)

            ct = r.headers.get("content-type", "")
            try:
                body = r.json() if "json" in ct else {"raw": r.text[:400]}
            except Exception:
                body = {"raw": r.text[:400]}

            logger.info(
                f"[buyer] {name} {method.upper()} {path} → {r.status_code}"
                + (f" [{label}]" if label else "")
            )
            return r.status_code, body

        except Exception as e:
            logger.debug(f"[buyer] Call failed {name} {path}: {e}")
            return 0, {"error": str(e)}

    def _log_purchase(
        self,
        from_id: str,
        to_id: str,
        message: str,
        status: int,
        body: dict,
    ):
        """Persist cross-team transaction to Supabase for prize evidence."""
        if not self.supa:
            return
        try:
            self.supa.table("agent_purchases").insert({
                "from_agent_id":   from_id,
                "to_agent_id":     to_id[:200],
                "message_sent":    message[:500],
                "response_status": status,
                "response_body":   json.dumps(body)[:2000],
            }).execute()
        except Exception as e:
            logger.debug(f"[buyer] Supabase log failed: {e}")

    # ── Main buying logic ──────────────────────────────────────────────────────

    async def _buy_from_known(self, topic: str):
        """Call all known hardcoded agents (guaranteed calls each cycle)."""
        for agent in KNOWN_AGENTS:
            name    = agent["name"]
            plan_id = agent.get("plan_id", "")
            url     = agent.get("url", "")
            if not url:
                continue

            token = self._get_token(plan_id)

            for call in agent.get("calls", []):
                status, body = await self._call_endpoint(
                    name=name,
                    url=url,
                    method=call["method"],
                    path=call["path"],
                    payload=call["payload"],
                    token=token,
                    label=call.get("label", ""),
                )
                self._log_purchase(
                    from_id="agentbazaar-known-buyer",
                    to_id=f"{name}|{plan_id[:30] if plan_id else url[:40]}",
                    message=f"{call['method']} {call['path']} | {json.dumps(call['payload'])[:120]}",
                    status=status,
                    body=body,
                )
                self._called_agents.add(name)
                await asyncio.sleep(1)  # brief pause between calls

    async def _buy_from_discovered(self, agents: list[dict], topic: str):
        """Call all discovered agents, rotating topics for variety."""
        for agent in agents:
            name    = agent.get("name", "unknown")
            plan_id = agent.get("plan_id", "")
            url     = agent.get("url", "")

            if not url:
                continue
            if len(self._called_agents) >= 20:
                logger.info("[buyer] Reached 20 unique counterparties cap — stopping discovery calls")
                break

            token = self._get_token(plan_id) if plan_id else ""

            # Try each generic call pattern until one succeeds
            for pattern in GENERIC_CALL_PATTERNS:
                payload_fn = pattern["payload"]
                payload    = payload_fn(topic) if callable(payload_fn) else payload_fn
                status, body = await self._call_endpoint(
                    name=name,
                    url=url,
                    method=pattern["method"],
                    path=pattern["path"],
                    payload=payload,
                    token=token,
                )
                tag = f"{agent.get('team', '')}|{plan_id[:20] if plan_id else url[:40]}"
                self._log_purchase(
                    from_id="agentbazaar-auto-buyer",
                    to_id=tag[:200],
                    message=f"{pattern['method']} {pattern['path']} | topic={topic[:60]}",
                    status=status,
                    body=body,
                )
                self._called_agents.add(name)
                # 200 or 402 (payment required) both mean the endpoint exists
                if status in (200, 201, 202, 402):
                    break
                await asyncio.sleep(0.5)

            await asyncio.sleep(2)  # rate-limit courtesy between agents

    # ── Public API ─────────────────────────────────────────────────────────────

    async def run_once(self):
        """
        One full buying cycle:
          1. Call all known hardcoded agents
          2. Discover + call all hackathon agents
          3. Paginate NVM node for any remaining plans
        """
        topic = RESEARCH_TOPICS[self._topic_idx % len(RESEARCH_TOPICS)]
        self._topic_idx += 1
        logger.info(f"[buyer] Starting buying cycle — topic: '{topic}'")
        logger.info(f"[buyer] Unique agents called so far: {len(self._called_agents)}")

        # Step 1: Known agents (guaranteed calls)
        await self._buy_from_known(topic)

        # Step 2: Hackathon discovery API
        discovered = await self._discover_hackathon_agents()
        if discovered:
            logger.info(f"[buyer] Discovered {len(discovered)} external agents via hackathon API")
            await self._buy_from_discovered(discovered, topic)

        # Step 3: NVM node pagination (if still under cap)
        if len(self._called_agents) < 20:
            nvm_agents = await self._paginate_nvm_plans()
            if nvm_agents:
                logger.info(f"[buyer] Found {len(nvm_agents)} additional agents via NVM node")
                await self._buy_from_discovered(nvm_agents, topic)

        logger.info(
            f"[buyer] Cycle complete — "
            f"plans ordered: {len(self._purchased_plans)}, "
            f"unique agents called: {len(self._called_agents)}"
        )

    async def run_loop(self, interval_seconds: int = 600):
        """Run autonomously in a background loop (every `interval_seconds`)."""
        await asyncio.sleep(60)   # brief warmup
        while True:
            try:
                await self.run_once()
            except Exception as e:
                logger.warning(f"[buyer] Cycle error: {e}")
            await asyncio.sleep(interval_seconds)


# ── Standalone entry-point ────────────────────────────────────────────────────
async def _main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    if not NVM_API_KEY:
        print("ERROR: NVM_API_KEY not set in environment")
        return

    # Optional: init payments SDK
    payments = None
    try:
        from payments_py import Payments, PaymentOptions
        payments = Payments.get_instance(
            PaymentOptions(nvm_api_key=NVM_API_KEY, environment=NVM_ENVIRONMENT)
        )
        print(f"[buyer] Payments SDK initialized ({NVM_ENVIRONMENT})")
    except Exception as e:
        print(f"[buyer] WARNING: payments SDK not available: {e}")

    # Optional: init Supabase for logging
    supabase = None
    if SUPABASE_URL and SUPABASE_KEY:
        try:
            from supabase import create_client
            supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
            print("[buyer] Supabase connected — transactions will be logged")
        except Exception as e:
            print(f"[buyer] WARNING: Supabase not available: {e}")

    buyer = AutonomousBuyer(payments=payments, supabase=supabase)

    print("\n=== AgentBazaar Autonomous Buyer ===")
    print(f"Environment : {NVM_ENVIRONMENT}")
    print(f"Known agents: {len(KNOWN_AGENTS)}")
    print("Starting single buying cycle...\n")

    await buyer.run_once()

    print(f"\nDone! Plans ordered: {len(buyer._purchased_plans)}")
    print(f"Unique agents called: {len(buyer._called_agents)}")


if __name__ == "__main__":
    asyncio.run(_main())
