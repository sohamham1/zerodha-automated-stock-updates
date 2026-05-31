import json
import re
import sys
from datetime import datetime, timezone
from html import unescape
from pathlib import Path


RECENT_WINDOW_DAYS = 45
BROKER_LOOKBACK_DAYS = 30
BROKER_HINTS = [
    "motilal oswal",
    "icici securities",
    "hdfc securities",
    "hdfc sky",
    "nuvama",
    "antique",
    "jefferies",
    "jm financial",
    "axis securities",
    "kotak institutional equities",
    "kotak securities",
    "emkay global financial",
    "emkay",
    "prabhudas lilladher",
    "choice broking",
    "geojit",
    "yes securities",
    "incred",
    "bernstein",
    "goldman sachs",
    "morgan stanley",
    "nomura",
    "jpmorgan",
    "citi",
    "hsbc",
    "macquarie",
    "phillipcapital",
    "sharekhan",
    "ventura",
    "sbi securities",
]
RATING_PATTERNS = [
    (re.compile(r"\bstrong buy\b|\bbuy\b|\baccumulate\b|\boutperform\b|\boverweight\b", re.I), "buy"),
    (re.compile(r"\bhold\b|\bneutral\b|\bmarket perform\b|\bequal weight\b|\bcautious\b", re.I), "neutral"),
    (re.compile(r"\bsell\b|\breduce\b|\bunderperform\b|\bunderweight\b|\bavoid\b", re.I), "sell"),
]


def clean_display_text(value):
    text = unescape(str(value or ""))
    replacements = {
        "â€“": "-",
        "â€”": "-",
        "â€˜": "'",
        "â€™": "'",
        "â€œ": '"',
        "â€�": '"',
        "â€¢": "-",
        "â€¦": "...",
        "Â": "",
        "₹": "Rs ",
    }
    for bad, good in replacements.items():
        text = text.replace(bad, good)
    text = text.replace("\u200b", "").replace("\ufeff", "")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def parse_date(value):
    if not value:
        return None
    try:
        return datetime.strptime(value, "%a, %d %b %Y %H:%M:%S %Z").replace(tzinfo=timezone.utc)
    except ValueError:
        try:
            normalized = str(value).replace("Z", "+00:00")
            parsed = datetime.fromisoformat(normalized)
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            return None


def format_date_label(value):
    parsed = parse_date(value)
    if not parsed:
        return "Date unavailable"
    return parsed.strftime("%d %b %Y")


def evidence_relevance_score(item):
    haystack = clean_display_text(f"{item.get('title', '')} {item.get('category', '')}").lower()
    score = 0
    if re.search(r"(profit|growth|beat|surge|order win|upgrade|dividend|record|expansion|target|results|earnings)", haystack):
        score += 2
    if re.search(r"(broker|buy|neutral|sell|target price)", haystack):
        score += 1
    if re.search(r"(fraud|downgrade|fall|probe|lawsuit|loss|miss|default|pledge|resigns|slips|tumbled|weakness)", haystack):
        score += 1
    return score


def freshness_bucket(published_at, report_date):
    parsed = parse_date(published_at)
    if not parsed:
        return "stale"
    age_days = max(0, int((report_date - parsed).days))
    return "recent" if age_days <= RECENT_WINDOW_DAYS else "stale"


def normalize_evidence(items, report_date):
    normalized = []
    for item in items or []:
        parsed = parse_date(item.get("publishedAt"))
        normalized.append({
            **item,
            "category": clean_display_text(item.get("category", "")),
            "source": clean_display_text(item.get("source", "Unknown source")),
            "title": clean_display_text(item.get("title", "Untitled source")),
            "url": clean_display_text(item.get("url", "")),
            "publishedAt": item.get("publishedAt"),
            "publishedAtLabel": format_date_label(item.get("publishedAt")),
            "publishedAtTs": parsed.timestamp() if parsed else 0,
            "freshness": freshness_bucket(item.get("publishedAt"), report_date),
            "relevanceScore": evidence_relevance_score(item),
        })
    normalized.sort(key=lambda item: (
        0 if item["freshness"] == "recent" else 1,
        -item["publishedAtTs"],
        -item["relevanceScore"],
        item["title"],
    ))
    return normalized


def normalize_text(value):
    return clean_display_text(value).lower().replace("&", " and ").replace("/", " ")


def extract_company_aliases(holding, seed_items=None):
    aliases = set()
    raw = [
        holding.get("displayName"),
        holding.get("companyName"),
        holding.get("symbol"),
        clean_display_text(holding.get("symbol", "")).replace("&", " and "),
    ]
    for item in raw:
        normalized = re.sub(r"[^a-z0-9\s]", " ", normalize_text(item))
        normalized = re.sub(r"\s+", " ", normalized).strip()
        if not normalized:
            continue
        aliases.add(normalized)
        words = normalized.split()
        if len(words) >= 2:
            aliases.add(" ".join(words[:2]))
        if len(words) >= 3:
            aliases.add(" ".join(words[:3]))

    symbol = clean_display_text(holding.get("symbol", ""))
    if seed_items:
        for item in seed_items:
            title = clean_display_text(item.get("title", ""))
            match = re.search(rf"([A-Za-z0-9&.,' -]+?)\s*\((?:NSE|BSE):{re.escape(symbol)}\)", title, re.I)
            if not match:
                continue
            normalized = re.sub(r"[^a-z0-9\s]", " ", normalize_text(match.group(1)))
            normalized = re.sub(r"\s+", " ", normalized).strip()
            if not normalized:
                continue
            aliases.add(normalized)
            words = normalized.split()
            if len(words) >= 2:
                aliases.add(" ".join(words[:2]))
            if len(words) >= 3:
                aliases.add(" ".join(words[:3]))
    return [alias for alias in aliases if len(alias) >= 3]


def extract_relevant_clause(title, aliases):
    title_without_source = clean_display_text(title).split(" - ")[0]
    normalized_full = re.sub(r"[^a-z0-9\s]", " ", normalize_text(title_without_source))
    normalized_full = re.sub(r"\s+", " ", normalized_full).strip()
    clauses = [part.strip() for part in re.split(r"[:;|,]", title_without_source) if part.strip()]
    for clause in clauses:
        normalized_clause = re.sub(r"[^a-z0-9\s]", " ", normalize_text(clause))
        normalized_clause = re.sub(r"\s+", " ", normalized_clause).strip()
        if any(alias in normalized_clause for alias in aliases):
            return clause
    return title_without_source if any(alias in normalized_full for alias in aliases) else ""


def extract_broker(title):
    lower = clean_display_text(title).lower()
    for broker in BROKER_HINTS:
        if broker in lower:
            return " ".join(part.capitalize() for part in broker.split())
    broker_suffix_match = re.search(r":\s*([^:]+?)\s*-\s*[^-]+$", clean_display_text(title), re.I)
    if broker_suffix_match:
        return clean_display_text(broker_suffix_match.group(1))
    maintain_match = re.search(r"^(.+?)\s+(?:maintains?|reiterates?|initiates?|upgrades?|downgrades?)\b", clean_display_text(title), re.I)
    if maintain_match:
        return clean_display_text(maintain_match.group(1))
    return None


def extract_rating(text):
    for pattern, value in RATING_PATTERNS:
        if pattern.search(clean_display_text(text)):
            return value
    return None


def is_within_broker_lookback(item, report_date):
    published = parse_date(item.get("publishedAt"))
    if not published:
        return False
    age_days = max(0, int((report_date - published).days))
    return age_days <= BROKER_LOOKBACK_DAYS


def pick_latest_by_broker(items):
    latest = {}
    for item in items:
        key = normalize_text(item.get("broker"))
        existing = latest.get(key)
        current_ts = parse_date(item.get("publishedAt"))
        existing_ts = parse_date(existing.get("publishedAt")) if existing else None
        if not existing or (current_ts and existing_ts and current_ts >= existing_ts):
            latest[key] = item
    return list(latest.values())


def build_broker_coverage_note(count):
    if count >= 5:
        return f"Coverage was built from {count} publicly visible brokerage recommendation items from the last {BROKER_LOOKBACK_DAYS} days."
    if count >= 2:
        return f"Only a small number of clearly attributable brokerage notes were visible in the last {BROKER_LOOKBACK_DAYS} days, so the consensus should be read as directional rather than comprehensive."
    if count == 1:
        return f"Only one clearly attributable brokerage note was visible in the last {BROKER_LOOKBACK_DAYS} days, so this should be treated as a light outside signal rather than a firm consensus."
    return f"No clearly attributable brokerage recommendation items were surfaced in the last {BROKER_LOOKBACK_DAYS} days, so this section relies more on price action and other public evidence than on broker consensus."


def broker_coverage_context(consensus):
    broker_count = int(consensus.get("scannedCount") or 0)
    if broker_count >= 4:
        return "broker coverage is broad enough to use as a useful secondary signal"
    if broker_count >= 2:
        return "broker coverage exists, but it is still fairly light"
    if broker_count == 1:
        return "only one recent broker note was visible, so that outside view should be treated cautiously"
    return "there were no clearly attributable recent broker calls in the public scan, which is common for parts of the market"


def rebuild_brokerage_consensus(holding, report_date):
    seed_items = (holding.get("evidence") or []) + ((holding.get("brokerageConsensus") or {}).get("items") or [])
    aliases = extract_company_aliases(holding, seed_items)
    parsed_items = []
    for item in seed_items:
        relevant_clause = extract_relevant_clause(item.get("title", ""), aliases)
        if not relevant_clause:
            continue
        broker = extract_broker(item.get("title", ""))
        if not broker:
            continue
        rating = extract_rating(relevant_clause) or extract_rating(item.get("title", ""))
        if not rating:
            continue
        candidate = {
            **item,
            "broker": clean_display_text(broker),
            "rating": rating,
            "matchedClause": clean_display_text(relevant_clause),
        }
        if is_within_broker_lookback(candidate, report_date):
            parsed_items.append(candidate)

    unique_by_broker = pick_latest_by_broker(parsed_items)
    counts = {"buy": 0, "neutral": 0, "sell": 0}
    for item in unique_by_broker:
        counts[item["rating"]] += 1

    coverage_note = build_broker_coverage_note(len(unique_by_broker))
    return {
        "scannedCount": len(unique_by_broker),
        **counts,
        "coverageNote": coverage_note,
        "items": normalize_evidence(unique_by_broker, report_date),
    }


def normalize_brokerage(consensus, report_date):
    consensus = dict(consensus or {})
    if "neutral" not in consensus and "hold" in consensus:
        consensus["neutral"] = consensus.get("hold", 0)
    consensus.pop("hold", None)
    consensus["buy"] = int(consensus.get("buy") or 0)
    consensus["neutral"] = int(consensus.get("neutral") or 0)
    consensus["sell"] = int(consensus.get("sell") or 0)
    consensus["scannedCount"] = int(consensus.get("scannedCount") or 0)
    consensus["coverageNote"] = clean_display_text(consensus.get("coverageNote", ""))
    consensus["items"] = [
        {
            **item,
            "broker": clean_display_text(item.get("broker") or item.get("source", "")),
            "rating": clean_display_text(item.get("rating", "")).lower(),
            "matchedClause": clean_display_text(item.get("matchedClause", "")),
        }
        for item in normalize_evidence(consensus.get("items") or [], report_date)
    ]
    return consensus


def extract_display_name(holding):
    symbol = clean_display_text(holding.get("symbol") or "")
    for item in holding.get("evidence") or []:
        title = clean_display_text(item.get("title", ""))
        match = re.search(rf"([A-Za-z0-9&.,' -]+?)\s*\((?:NSE|BSE):{re.escape(symbol)}\)", title, re.I)
        if match:
            candidate = clean_display_text(match.group(1).replace("'s", "")).rstrip("'")
            candidate = re.sub(r"^(the total return for|is|will weakness in|should you buy|unpleasant surprises could be in store for)\s+", "", candidate, flags=re.I)
            candidate = re.sub(r"^individual investors own .*? of\s+", "", candidate, flags=re.I)
            candidate = re.sub(r"^of\s+", "", candidate, flags=re.I)
            candidate = re.sub(r"^we think that there are issues underlying\s+", "", candidate, flags=re.I)
            candidate = re.sub(r"^a day ahead of .*?,\s+", "", candidate, flags=re.I).strip()
            if re.match(r"^(the|is|will|should|why)\b", candidate, flags=re.I):
                fragments = [clean_display_text(part) for part in re.split(r"\b(?:for|in|of)\b", candidate, flags=re.I) if clean_display_text(part)]
                candidate = fragments[-1] if fragments else candidate
            return candidate
    company_name = clean_display_text(holding.get("companyName") or "")
    if company_name and company_name != symbol and " " in company_name:
        return company_name
    return symbol.title()


def performance_score(holding):
    return_pct = float(holding.get("returnPct") or 0)
    weekly_change = float(holding.get("weeklyChangePct") or 0)
    score = 0
    if return_pct <= -35:
        score -= 2
    elif return_pct <= -15:
        score -= 1
    elif return_pct >= 50:
        score += 2
    elif return_pct >= 15:
        score += 1
    if weekly_change <= -3:
        score -= 1
    elif weekly_change >= 3:
        score += 1
    return score


def trend_score(holding):
    trends = holding.get("trends") or {}
    sma50 = trends.get("sma50")
    rsi14 = trends.get("rsi14")
    last_price = holding.get("lastPrice")
    score = 0
    if sma50 is not None and last_price is not None:
        score += 1 if float(last_price) >= float(sma50) else -1
    if isinstance(rsi14, (int, float)):
        if rsi14 >= 70 or rsi14 <= 40:
            score -= 1
        elif 45 <= rsi14 <= 65:
            score += 1
    return score


def broker_score(holding):
    consensus = holding.get("brokerageConsensus") or {}
    scanned = int(consensus.get("scannedCount") or 0)
    if scanned == 0:
        return 0
    buy = int(consensus.get("buy") or 0)
    neutral = int(consensus.get("neutral") or 0)
    sell = int(consensus.get("sell") or 0)
    if sell > buy:
        return -1
    if buy > sell and buy >= neutral:
        return 1
    return 0


def dominant_categories(evidence):
    counts = {}
    for item in evidence:
        category = clean_display_text(item.get("category", "")).lower() or "company updates"
        counts[category] = counts.get(category, 0) + 1
    return [name for name, _ in sorted(counts.items(), key=lambda pair: pair[1], reverse=True)[:2]]


def build_confidence(evidence, consensus):
    recent_count = len([item for item in evidence if item.get("freshness") == "recent"])
    broker_count = int(consensus.get("scannedCount") or 0)
    if recent_count >= 4 or broker_count >= 4:
        return "high", "Confidence is high because the view is backed by multiple recent sources and/or meaningful external coverage."
    if recent_count >= 2 or broker_count >= 2:
        return "medium", "Confidence is medium because there is some recent evidence, but coverage is still partial."
        return "low", "Confidence is low because the view relies on sparse or stale evidence and only limited recent broker visibility."


def select_citations(evidence, limit=3):
    recent = [item for item in evidence if item.get("freshness") == "recent"]
    stale = [item for item in evidence if item.get("freshness") != "recent"]
    selected = recent[:limit]
    if len(selected) < limit:
        for item in stale[: limit - len(selected)]:
            selected.append({**item, "freshness": "fallback"})
    return [
        {
            "title": item.get("title"),
            "url": item.get("url"),
            "source": item.get("source"),
            "publishedAt": item.get("publishedAt"),
            "publishedAtLabel": item.get("publishedAtLabel"),
            "freshness": item.get("freshness"),
        }
        for item in selected
    ]


def build_summary(holding, report_date):
    evidence = holding.get("evidence") or []
    consensus = holding.get("brokerageConsensus") or {}
    total_score = performance_score(holding) + trend_score(holding) + broker_score(holding) + sum(item.get("relevanceScore", 0) for item in evidence)
    recent_count = len([item for item in evidence if item.get("freshness") == "recent"])

    if recent_count < 2 and abs(total_score) < 2:
        sentiment = "unclear"
    elif float(holding.get("returnPct") or 0) <= -20 and (float(holding.get("weeklyChangePct") or 0) < 0 or trend_score(holding) <= 0):
        sentiment = "cautious"
    elif float(holding.get("returnPct") or 0) >= 40 and total_score >= 1:
        sentiment = "bullish"
    elif total_score <= -1:
        sentiment = "cautious"
    elif total_score >= 1:
        sentiment = "bullish"
    else:
        sentiment = "neutral"

    confidence, confidence_reason = build_confidence(evidence, consensus)
    categories = dominant_categories(evidence if recent_count else evidence)
    weekly_change = float(holding.get("weeklyChangePct") or 0)
    if weekly_change >= 2:
        move_descriptor = "a strong positive weekly move"
    elif weekly_change <= -2:
        move_descriptor = "a notable weekly pullback"
    else:
        move_descriptor = "a relatively muted weekly move"

    trends = holding.get("trends") or {}
    sma50 = trends.get("sma50")
    last_price = holding.get("lastPrice")
    if sma50 is None or last_price is None:
        trend_phrase = "trend context is limited because the 50-day SMA was not available"
    else:
        trend_phrase = "price is still above the 50-day SMA" if float(last_price) >= float(sma50) else "price remains below the 50-day SMA"

    why_parts = [f"This week's move looks tied to {move_descriptor}"]
    if categories:
        why_parts.append(f"with the clearest signals coming from {' and '.join(categories)} updates")
    why_parts.append(trend_phrase)
    if int(consensus.get("scannedCount") or 0) >= 2:
        why_parts.append(f"and broker coverage currently leans Buy {consensus['buy']} / Neutral {consensus['neutral']} / Sell {consensus['sell']}")
    why_moving = ", ".join(why_parts) + "."

    reasons = []
    return_pct = float(holding.get("returnPct") or 0)
    if return_pct <= -15:
        reasons.append(f"all-time return remains weak at {return_pct:.2f}%")
    elif return_pct >= 15:
        reasons.append(f"all-time return remains strong at {return_pct:.2f}%")
    if sma50 is not None and last_price is not None:
        reasons.append("price is above the 50-day SMA" if float(last_price) >= float(sma50) else "price is below the 50-day SMA")
    if int(consensus.get("scannedCount") or 0) >= 2:
        reasons.append(f"broker coverage reads Buy {consensus['buy']} / Neutral {consensus['neutral']} / Sell {consensus['sell']}")
    else:
        reasons.append(broker_coverage_context(consensus))
    prefix = "Unclear because" if sentiment == "unclear" else f"{sentiment.title()} because"
    rationale = f"{prefix} {', '.join(reasons)}."

    missing_evidence = []
    if recent_count < 2:
        missing_evidence.append("Recent public evidence is thin, so the weekly angle is only partially supported.")
    if any(item.get("freshness") == "stale" for item in evidence):
        missing_evidence.append("Some supporting references are older and should be treated as background, not fresh confirmation.")
    if int(consensus.get("scannedCount") or 0) < 2:
        missing_evidence.append("Recent broker visibility is limited, so the report leans more heavily on price action and non-broker public evidence.")

    watchpoints = []
    if float(holding.get("portfolioWeight") or 0) >= 25:
        watchpoints.append("Portfolio concentration is high here, so position sizing matters more than normal.")
    if return_pct <= -20:
        watchpoints.append("The position is still well below cost, so thesis validation matters more than headline noise.")
    if weekly_change <= -3:
        watchpoints.append("The recent weekly drop deserves a follow-up check against filings, management commentary, or sector news.")
    if int(consensus.get("scannedCount") or 0) < 2:
        watchpoints.append("Use outside broker commentary only as a light cross-check here, because recent public coverage is limited.")
    if not watchpoints:
        watchpoints.append("Track whether the latest evidence continues to show up in filings, management commentary, or broker follow-ups.")

    key_developments = [f"{item.get('title')} ({item.get('source')})" for item in evidence[:4]]

    return {
        "sentiment": sentiment,
        "confidence": confidence,
        "confidenceReason": confidence_reason,
        "keyDevelopments": key_developments,
        "whyMoving": why_moving,
        "watchpoints": watchpoints,
        "missingEvidence": missing_evidence,
        "rationale": rationale,
        "citations": select_citations(evidence, 3),
        "updatedAt": report_date.isoformat(),
    }


def refresh_holding(holding, report_date):
    holding["symbol"] = clean_display_text(holding.get("symbol", ""))
    holding["ticker"] = clean_display_text(holding.get("ticker") or holding.get("symbol", ""))
    holding["exchangeLabel"] = clean_display_text(holding.get("exchangeLabel") or holding.get("exchange", ""))
    holding["companyName"] = clean_display_text(holding.get("companyName", ""))
    holding["evidence"] = normalize_evidence(holding.get("evidence") or [], report_date)
    holding["displayName"] = extract_display_name(holding)
    rebuilt_consensus = rebuild_brokerage_consensus(holding, report_date)
    if rebuilt_consensus.get("scannedCount", 0) >= 0:
        holding["brokerageConsensus"] = rebuilt_consensus
    else:
        holding["brokerageConsensus"] = normalize_brokerage(holding.get("brokerageConsensus") or {}, report_date)
    holding["summary"] = build_summary(holding, report_date)


def refresh_report(report):
    report_date = parse_date(report.get("generatedAt")) or datetime.now(timezone.utc)
    counts = {"bullish": 0, "neutral": 0, "cautious": 0, "unclear": 0}
    for holding in report.get("holdings", []):
        refresh_holding(holding, report_date)
        counts[holding["summary"]["sentiment"]] = counts.get(holding["summary"]["sentiment"], 0) + 1
    report.setdefault("summary", {})["sentimentCounts"] = counts
    return report


def main():
    report_path = Path(sys.argv[1])
    report = json.loads(report_path.read_text(encoding="utf-8"))
    refreshed = refresh_report(report)
    report_path.write_text(json.dumps(refreshed, ensure_ascii=False, indent=2), encoding="utf-8")
    print("ok")


if __name__ == "__main__":
    main()
