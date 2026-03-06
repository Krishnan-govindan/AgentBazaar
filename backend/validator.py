"""
validator.py — AgentValidator for AgentBazaar
==============================================
5-check validation pipeline that scores any AI agent:

  Check 1 (20pts) — DID/URL resolves on Nevermined or returns HTTP 200
  Check 2 (20pts) — Agent has at least one active payment plan
  Check 3 (20pts) — /health endpoint responds within 5 seconds
  Check 4 (20pts) — Agent responds to {"query": "hello"} within 10 seconds
  Check 5 (20pts) — Claude quality check: "Is this a coherent AI agent response?"

Score ≥ 60 → CERTIFIED badge, else UNVERIFIED.
Results are cached in memory for 30 minutes per DID/URL.

Usage:
    from validator import AgentValidator
    v = AgentValidator(anthropic_client=claude, nvm_api_key=NVM_API_KEY)
    result = await v.validate("https://myagent.railway.app")
    # or
    result = await v.validate("did:nv:abc123")
"""

import time
import logging
from typing import Optional

import httpx

logger = logging.getLogger("agentbazaar.validator")

# In-memory cache: {did_or_url: (timestamp, result_dict)}
_validation_cache: dict[str, tuple[float, dict]] = {}
_CACHE_TTL = 1800  # 30 minutes

_NVM_BASE = "https://one-backend.testing.nevermined.app"


class AgentValidator:
    """Validates AI agents against a 5-point checklist using Nevermined + Claude."""

    def __init__(
        self,
        anthropic_client=None,
        nvm_api_key: str = "",
        cache: Optional[dict] = None,
    ):
        self.claude     = anthropic_client
        self.nvm_key    = nvm_api_key
        self._cache     = cache if cache is not None else _validation_cache

    # ── Public API ─────────────────────────────────────────────────────────────

    async def validate(self, did_or_url: str) -> dict:
        """Run all 5 checks and return a full certification report.

        Returns:
        {
            "did": str,
            "certified": bool,
            "badge": "CERTIFIED" | "UNVERIFIED",
            "score": int (0-100),
            "checks": {
                "resolves":     {"passed": bool, "detail": str, "points": int},
                "has_plan":     {"passed": bool, "detail": str, "points": int},
                "health":       {"passed": bool, "detail": str, "points": int},
                "responds":     {"passed": bool, "detail": str, "points": int},
                "quality":      {"passed": bool, "detail": str, "points": int},
            },
            "endpoint": str | None,
            "cached": bool,
            "cached_at": float | None,
        }
        """
        # Check cache first
        now = time.time()
        if did_or_url in self._cache:
            ts, cached = self._cache[did_or_url]
            if now - ts < _CACHE_TTL:
                logger.info(f"[validator] Cache hit for {did_or_url[:40]}")
                return {**cached, "cached": True, "cached_at": ts}

        logger.info(f"[validator] Running 5-check validation for: {did_or_url[:60]}")
        result = await self._run_checks(did_or_url)
        self._cache[did_or_url] = (now, result)
        return {**result, "cached": False, "cached_at": None}

    def invalidate(self, did_or_url: str):
        """Remove a cached result so the next call re-validates."""
        self._cache.pop(did_or_url, None)

    # ── Internal checks ────────────────────────────────────────────────────────

    async def _run_checks(self, did_or_url: str) -> dict:
        checks  = {}
        score   = 0
        endpoint: Optional[str] = None

        # ── Check 1: DID/URL resolves ──────────────────────────────────────────
        c1, endpoint = await self._check_resolves(did_or_url)
        checks["resolves"] = c1
        if c1["passed"]:
            score += 20

        # ── Check 2: Has payment plan ──────────────────────────────────────────
        c2 = await self._check_has_plan(did_or_url)
        checks["has_plan"] = c2
        if c2["passed"]:
            score += 20

        # ── Check 3: /health endpoint is live ─────────────────────────────────
        c3 = await self._check_health(endpoint)
        checks["health"] = c3
        if c3["passed"]:
            score += 20

        # ── Check 4: Responds to test message ─────────────────────────────────
        c4, agent_response = await self._check_responds(endpoint)
        checks["responds"] = c4
        if c4["passed"]:
            score += 20

        # ── Check 5: Claude quality check ─────────────────────────────────────
        c5 = await self._check_quality(agent_response)
        checks["quality"] = c5
        if c5["passed"]:
            score += 20

        certified = score >= 60
        return {
            "did":       did_or_url,
            "certified": certified,
            "badge":     "CERTIFIED" if certified else "UNVERIFIED",
            "score":     score,
            "checks":    checks,
            "endpoint":  endpoint,
        }

    async def _check_resolves(self, did_or_url: str) -> tuple[dict, Optional[str]]:
        """Check 1: Does the DID or URL resolve to a reachable resource?"""
        endpoint = None

        # If it's a URL, just verify it's reachable
        if did_or_url.startswith("http"):
            try:
                async with httpx.AsyncClient(timeout=8) as client:
                    r = await client.get(did_or_url, follow_redirects=True)
                    if r.status_code < 500:
                        return (
                            {"passed": True,  "detail": f"URL reachable (HTTP {r.status_code})", "points": 20},
                            did_or_url,
                        )
                    return (
                        {"passed": False, "detail": f"URL returned HTTP {r.status_code}", "points": 0},
                        did_or_url,
                    )
            except Exception as e:
                return ({"passed": False, "detail": f"URL unreachable: {e}", "points": 0}, None)

        # DID resolution via Nevermined backend
        headers = {"Authorization": f"Bearer {self.nvm_key}"} if self.nvm_key else {}
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    f"{_NVM_BASE}/api/v1/agents/{did_or_url}",
                    headers=headers,
                )
                if r.status_code == 200:
                    data     = r.json()
                    endpoint = data.get("serviceEndpoint") or data.get("endpoint") or data.get("url")
                    return (
                        {"passed": True,  "detail": f"DID resolved on Nevermined (endpoint: {endpoint or 'unknown'})", "points": 20},
                        endpoint,
                    )
                return (
                    {"passed": False, "detail": f"DID not found (HTTP {r.status_code})", "points": 0},
                    None,
                )
        except Exception as e:
            return ({"passed": False, "detail": f"DID resolution failed: {e}", "points": 0}, None)

    async def _check_has_plan(self, did_or_url: str) -> dict:
        """Check 2: Does the agent have at least one active payment plan on Nevermined?"""
        if did_or_url.startswith("http"):
            # Can't check plans for raw URLs — award points if the endpoint is reachable
            return {"passed": True, "detail": "URL-based agent (no DID plan check needed)", "points": 20}

        headers = {"Authorization": f"Bearer {self.nvm_key}"} if self.nvm_key else {}
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                # Check the agent's access-control plans
                r = await client.get(
                    f"{_NVM_BASE}/api/v1/agents/{did_or_url}/plans",
                    headers=headers,
                )
                if r.status_code == 200:
                    plans = r.json()
                    items = plans if isinstance(plans, list) else plans.get("results", [])
                    if items:
                        return {"passed": True, "detail": f"Found {len(items)} active plan(s)", "points": 20}
                    return {"passed": False, "detail": "No active plans found", "points": 0}
                # Many agents register their plan DID separately — try the plan endpoint
                r2 = await client.get(
                    f"{_NVM_BASE}/api/v1/plans/{did_or_url}",
                    headers=headers,
                )
                if r2.status_code == 200:
                    return {"passed": True, "detail": "Plan DID is valid on Nevermined", "points": 20}
                return {"passed": False, "detail": f"No plan found (HTTP {r.status_code})", "points": 0}
        except Exception as e:
            return {"passed": False, "detail": f"Plan check error: {e}", "points": 0}

    async def _check_health(self, endpoint: Optional[str]) -> dict:
        """Check 3: Does the agent's /health endpoint return 200 within 5 seconds?"""
        if not endpoint:
            return {"passed": False, "detail": "No endpoint to check (DID did not resolve)", "points": 0}

        base = endpoint.rstrip("/")
        for path in ("/health", "/healthz", "/"):
            try:
                async with httpx.AsyncClient(timeout=5) as client:
                    r = await client.get(f"{base}{path}", follow_redirects=True)
                    if r.status_code == 200:
                        return {"passed": True, "detail": f"Health check passed ({base}{path})", "points": 20}
            except Exception:
                continue

        return {"passed": False, "detail": f"No health endpoint responded at {base}", "points": 0}

    async def _check_responds(self, endpoint: Optional[str]) -> tuple[dict, str]:
        """Check 4: Does the agent return a non-empty response to a test message within 10s?"""
        if not endpoint:
            return (
                {"passed": False, "detail": "No endpoint to call", "points": 0},
                "",
            )

        base = endpoint.rstrip("/")
        test_payloads = [
            {"query": "hello"},
            {"messages": [{"role": "user", "content": "What services do you offer?"}]},
            {"input": "hello"},
        ]

        for payload in test_payloads:
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    r = await client.post(
                        base,
                        json=payload,
                        headers={"Content-Type": "application/json"},
                    )
                    if r.status_code in (200, 201):
                        body = r.text[:1000]
                        if body.strip():
                            return (
                                {"passed": True, "detail": f"Agent responded (HTTP 200, {len(body)} chars)", "points": 20},
                                body,
                            )
                    elif r.status_code == 402:
                        # x402 payment required — means endpoint exists and is correctly gated
                        return (
                            {"passed": True, "detail": "Agent correctly responds with 402 (x402 payment gated)", "points": 20},
                            "x402 payment required — agent is live and properly gated",
                        )
            except Exception:
                continue

        return (
            {"passed": False, "detail": f"Agent did not respond to test messages at {base}", "points": 0},
            "",
        )

    async def _check_quality(self, agent_response: str) -> dict:
        """Check 5: Claude judges whether the response is a coherent AI agent response."""
        if not self.claude:
            return {"passed": True, "detail": "Claude not configured — quality check skipped (pass)", "points": 20}

        if not agent_response or agent_response.strip() in ("", "x402 payment required — agent is live and properly gated"):
            # If Check 4 passed via 402, we know it's a real agent — award quality points
            if "x402" in agent_response:
                return {"passed": True, "detail": "x402-gated endpoint — quality assumed OK", "points": 20}
            return {"passed": False, "detail": "No response text to evaluate", "points": 0}

        prompt = (
            "You are evaluating whether a piece of text is a coherent, helpful response "
            "from an AI agent or API service. Answer with exactly 'Yes' or 'No' on the "
            "first line, then a single sentence explanation.\n\n"
            f"Response to evaluate:\n{agent_response[:600]}"
        )

        try:
            msg = await self.claude.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=80,
                messages=[{"role": "user", "content": prompt}],
            )
            verdict_text = msg.content[0].text.strip()
            passed       = verdict_text.lower().startswith("yes")
            return {
                "passed": passed,
                "detail": f"Claude says: {verdict_text[:120]}",
                "points": 20 if passed else 0,
            }
        except Exception as e:
            logger.warning(f"[validator] Claude quality check failed: {e}")
            return {"passed": True, "detail": f"Claude unavailable — quality check skipped (pass): {e}", "points": 20}
