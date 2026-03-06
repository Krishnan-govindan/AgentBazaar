#!/usr/bin/env python3
"""
Autonomous buyer — discovers ALL Nevermined marketplace agents and calls them.

CRITICAL for hackathon scoring! Multipliers:
  - Plans bought: x4
  - Calls made: x4  
  - Diversity (unique agents): x3, cap 20

Usage:
    pip install httpx payments-py python-dotenv
    python autonomous_buyer.py
"""

import asyncio, os, random, sys, warnings
warnings.filterwarnings("ignore", message="Unverified HTTPS request")

from dotenv import load_dotenv
load_dotenv()

import httpx
from payments_py import Payments, PaymentOptions

NVM_API_KEY = os.environ.get("NVM_API_KEY", "")
if not NVM_API_KEY:
    print("ERROR: NVM_API_KEY required"); sys.exit(1)

payments = Payments.get_instance(PaymentOptions(nvm_api_key=NVM_API_KEY, environment=os.environ.get("NVM_ENVIRONMENT", "sandbox")))
NVM_API_BASE = "https://api.sandbox.nevermined.app/api/v1/protocol"
OWN_AGENT_ID = os.environ.get("NVM_AGENT_ID", "")
OWN_PLAN_ID = os.environ.get("NVM_PLAN_ID", "")

QUERIES = ["AI marketplace trends", "Agent commerce protocols", "Autonomous business models", "Decentralized AI systems", "Multi-agent orchestration"]

def _urls(endpoints, base_url=""):
    urls = []
    for ep in endpoints:
        if not isinstance(ep, dict): continue
        for m in ("POST","post"): 
            if m in ep and ep[m].startswith("http"): urls.append(ep[m])
        if ep.get("verb","").upper()=="POST" and ep.get("url","").startswith("http"): urls.append(ep["url"])
        elif ep.get("verb","").upper()=="POST" and base_url.startswith("http") and ep.get("url","").startswith("/"): urls.append(f"{base_url.rstrip('/')}{ep['url']}")
    return list(dict.fromkeys(urls))

async def discover():
    discovered, seen = [], set()
    headers = {"Authorization": f"Bearer {NVM_API_KEY}"}
    async with httpx.AsyncClient(timeout=15.0) as client:
        plans, page = [], 1
        while True:
            r = await client.get(f"{NVM_API_BASE}/all-plans", params={"page": page, "offset": 100}, headers=headers)
            if r.status_code != 200: break
            d = r.json()
            plans.extend(d.get("plans", []))
            print(f"  [Discovery] Page {page}: {len(d.get('plans',[]))} plans")
            if len(plans) >= d.get("total", 0) or not d.get("plans"): break
            page += 1
        
        candidates = [p for p in plans if p.get("id") != OWN_PLAN_ID and "DEACTIVATED" not in p.get("metadata",{}).get("main",{}).get("name","").upper()]
        sem = asyncio.Semaphore(10)
        
        async def fetch(p):
            async with sem:
                try:
                    r = await client.get(f"{NVM_API_BASE}/plans/{p['id']}/agents", headers=headers)
                    if r.status_code != 200: return
                    for a in r.json().get("agents", []):
                        aid = a.get("id","")
                        if not aid or aid == OWN_AGENT_ID or aid in seen: continue
                        m = a.get("metadata",{})
                        if "DEACTIVATED" in m.get("main",{}).get("name","").upper(): continue
                        seen.add(aid)
                        discovered.append({"agent_id": aid, "name": m.get("main",{}).get("name","?"), "plan_id": p["id"], "endpoints": m.get("agent",{}).get("endpoints",[]), "base_url": m.get("agent",{}).get("agentDefinitionUrl","")})
                except: pass
        await asyncio.gather(*[fetch(p) for p in candidates])
    print(f"  [Discovery] {len(discovered)} agents")
    return discovered

async def call(info, query):
    headers = {"Authorization": f"Bearer {NVM_API_KEY}", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            await client.post(f"{NVM_API_BASE}/plans/{info['plan_id']}/order", headers=headers)
            tr = await client.get(f"{NVM_API_BASE}/token/{info['plan_id']}/{info['agent_id']}", headers=headers)
            if tr.status_code != 200: return {"success": False}
            token = tr.json().get("accessToken", tr.json().get("token", ""))
            if not token: return {"success": False}
            urls = _urls(info.get("endpoints",[]), info.get("base_url",""))
            if not urls and info.get("base_url","").startswith("http"):
                for p in ["/ask","/query","/search"]: urls.append(f"{info['base_url'].rstrip('/')}{p}")
            for url in urls:
                try:
                    r = await client.post(url, json={"query": query}, headers={"Content-Type": "application/json", "payment-signature": token})
                    print(f"  [Call] {info['name']} -> {r.status_code}")
                    if r.status_code in (200,201,202): return {"success": True}
                except: pass
    except: pass
    return {"success": False}

async def run(rounds=10, delay=30, per_round=40):
    print(f"\n{'='*50}\n  Autonomous Buyer\n{'='*50}\n")
    called, total, ok, agents = set(), 0, 0, []
    for rnd in range(1, rounds+1):
        print(f"\n--- Round {rnd}/{rounds} ---")
        if not agents or rnd % 3 == 1: agents = await discover()
        if not agents: await asyncio.sleep(delay); continue
        batch = ([a for a in agents if a["agent_id"] not in called] + [a for a in agents if a["agent_id"] in called])[:per_round]
        for a in batch:
            r = await call(a, random.choice(QUERIES))
            total += 1
            if r.get("success"): ok += 1
            if a["agent_id"] not in called: called.add(a["agent_id"])
            await asyncio.sleep(1)
        print(f"[Stats] {total} calls, {ok} ok, {len(called)} unique")
        if rnd < rounds: await asyncio.sleep(delay)
    print(f"\n{'='*50}\n  DONE: {total} calls, {ok} ok, {len(called)} unique\n{'='*50}\n")

if __name__ == "__main__":
    asyncio.run(run(int(os.environ.get("BUYER_MAX_ROUNDS","10")), int(os.environ.get("BUYER_DELAY","30")), int(os.environ.get("BUYER_PER_ROUND","40"))))
