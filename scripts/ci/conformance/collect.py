"""Collects per-module results of conformance plans from the suite's API.

Usage: python3 collect.py OUT_DIR PLAN_ID [PLAN_ID...]

Writes OUT_DIR/results.json (every module, with the non-success log entries)
and OUT_DIR/summary.md, and exits 1 when any module FAILED, was INTERRUPTED,
or never ran: an incomplete run must not look green. WARNING, REVIEW and
SKIPPED are reported, not failed: REVIEW needs a human to look at a
screenshot, and the WARNINGs are listed in the summary.
"""
import json
import ssl
import sys
import urllib.request

BASE = "https://localhost.emobix.co.uk:8443"
# The suite's own dev-mode certificate; this talks only to the suite, inside
# the private compose network.
CTX = ssl._create_unverified_context()
BAD = {"FAILED", "INTERRUPTED", "NOT_RUN", "None"}


def get(path):
    with urllib.request.urlopen(BASE + path, context=CTX, timeout=60) as r:
        return json.load(r)


out_dir, plan_ids = sys.argv[1], sys.argv[2:]
plans = []
for plan_id in plan_ids:
    plan = get(f"/api/plan/{plan_id}")
    entry = {"plan_id": plan_id, "plan": plan.get("planName"), "variant": plan.get("variant"), "modules": []}
    for m in plan.get("modules", []):
        rec = {"module": m.get("testModule"), "variant": m.get("variant")}
        insts = m.get("instances") or []
        if not insts:
            rec.update(result="NOT_RUN", status=None, messages=[])
            entry["modules"].append(rec)
            continue
        tid = insts[-1]
        info = get(f"/api/info/{tid}")
        rec.update(test_id=tid, status=info.get("status"), result=str(info.get("result")))
        msgs = []
        for e in get(f"/api/log/{tid}"):
            if e.get("result") in ("FAILURE", "WARNING", "REVIEW", "INTERRUPTED", "SKIPPED"):
                msgs.append({k: e[k] for k in ("src", "result", "msg", "requirements") if k in e})
        rec["messages"] = msgs
        entry["modules"].append(rec)
    plans.append(entry)

with open(f"{out_dir}/results.json", "w") as f:
    json.dump(plans, f, indent=2, default=str)

lines = ["## OpenID conformance", ""]
failed = []
for p in plans:
    counts = {}
    for m in p["modules"]:
        counts[m["result"]] = counts.get(m["result"], 0) + 1
    lines.append(f"### {p['plan']} ({p['plan_id']})")
    lines.append("")
    lines.append(", ".join(f"{k}: {v}" for k, v in sorted(counts.items())))
    lines.append("")
    lines.append("| Result | Module | Notes |")
    lines.append("|---|---|---|")
    for m in p["modules"]:
        notes = "; ".join(
            f"{d.get('src')}: {str(d.get('msg'))[:140]}" for d in m["messages"][:3]
        ).replace("|", "/").replace("\n", " ")
        result = m["result"]
        if result in BAD:
            failed.append(f"{p['plan']}/{m['module']}")
            result = f"**{result}**"
        lines.append(f"| {result} | {m['module']} | {notes} |")
    lines.append("")
if failed:
    lines.append(f"**{len(failed)} module(s) failed or did not complete:** " + ", ".join(failed))
with open(f"{out_dir}/summary.md", "w") as f:
    f.write("\n".join(lines) + "\n")
print("\n".join(lines))
sys.exit(1 if failed else 0)
