"""Deterministic, explainable website assessment. No arbitrary URL fetching occurs."""
from __future__ import annotations

import difflib
import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

try:
    import tldextract
    _TLD_EXTRACTOR = tldextract.TLDExtract(suffix_list_urls=(), cache_dir=None)
except ImportError:  # Useful for restricted/offline developer environments; not production-grade.
    tldextract = None
    _TLD_EXTRACTOR = None

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
OFFICIAL_REGISTRY_PATH = DATA_DIR / "official_domains.json"
THREAT_LIST_PATH = DATA_DIR / "threat_domains.json"


def _load_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def normalize_url(raw_url: str) -> tuple[str, str]:
    value = raw_url.strip()
    if not value:
        raise ValueError("Enter a website URL.")
    if "://" not in value:
        value = "https://" + value
    parsed = urlsplit(value)
    if parsed.scheme.lower() not in {"http", "https"}:
        raise ValueError("Only HTTP and HTTPS addresses can be checked.")
    if parsed.username or parsed.password:
        raise ValueError("URLs containing embedded usernames or passwords are not accepted.")
    if not parsed.hostname:
        raise ValueError("The address does not contain a valid hostname.")
    try:
        hostname = parsed.hostname.rstrip(".").encode("idna").decode("ascii").lower()
    except UnicodeError as exc:
        raise ValueError("The hostname could not be normalized.") from exc
    if len(hostname) > 253 or any(not label or len(label) > 63 for label in hostname.split(".")):
        raise ValueError("The hostname is invalid.")
    port = f":{parsed.port}" if parsed.port else ""
    netloc = hostname + port
    normalized = urlunsplit((parsed.scheme.lower(), netloc, parsed.path or "/", parsed.query, ""))
    return normalized, hostname


def _registrable_guess(hostname: str) -> str:
    """Extract the registrable domain using tldextract's bundled suffix snapshot.

    Network suffix-list updates are disabled so analysis is deterministic and does
    not contact a third party. Keep the bundled data updated with dependency updates.
    """
    if _TLD_EXTRACTOR is not None:
        extracted = _TLD_EXTRACTOR(hostname)
        return extracted.top_domain_under_public_suffix or hostname
    # Limited offline fallback only. A complete PSL-backed parser is required for release.
    labels = hostname.split(".")
    two_level_suffixes = {"co.in", "com.au", "co.uk", "com.br", "co.nz", "com.sg", "co.jp"}
    if len(labels) >= 3 and ".".join(labels[-2:]) in two_level_suffixes:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:]) if len(labels) >= 2 else hostname


def check_site(payload: dict[str, Any]) -> dict[str, Any]:
    normalized_url, hostname = normalize_url(str(payload.get("url", "")))
    mode = payload.get("mode", "current_tab")
    raw_snapshot = payload.get("page_snapshot")
    snapshot_available = (
        mode == "current_tab"
        and isinstance(raw_snapshot, dict)
        and bool(raw_snapshot)
    )
    forms_available = (
        mode == "current_tab"
        and isinstance(raw_snapshot, dict)
        and isinstance(raw_snapshot.get("forms"), list)
    )
    snapshot = raw_snapshot if isinstance(raw_snapshot, dict) else {}
    title = str(snapshot.get("title", ""))[:300]
    page_text = str(snapshot.get("text", ""))[:15000]
    forms = snapshot.get("forms", [])[:100] if forms_available else []

    registry = _load_json(OFFICIAL_REGISTRY_PATH, [])
    threat_list = _load_json(THREAT_LIST_PATH, [])
    if not isinstance(registry, list):
        registry = []
    if not isinstance(threat_list, list):
        threat_list = []

    evidence: list[dict[str, Any]] = []
    def log(check: str, source: str, result: str, status: str = "ok", detail: str | None = None):
        item = {"id": f"L{len(evidence)+1}", "check": check, "source": source, "result": result, "status": status}
        if detail:
            item["detail"] = detail
        evidence.append(item)

    log("url_normalization", "local URL parser", f"Normalized to {hostname}")
    threat_hit = any(str(item).lower() in {hostname, normalized_url.lower()} for item in threat_list)
    if threat_hit:
        log("threat_list", "local threat list", "Exact hostname matched the configured threat list")
        return _result("very_unsafe", "The hostname matched the configured threat list.", normalized_url, mode, evidence,
                       ["Threat-list entries must be kept current and verified."], ["domain age", "certificate details", "social reviews"])
    log("threat_list", "local threat list", "No local-list match; this is not proof of safety")

    registry_entries = [entry for entry in registry if isinstance(entry, dict) and isinstance(entry.get("hostname"), str)]
    exact = next((entry for entry in registry_entries if entry["hostname"].lower().strip(".") == hostname), None)
    if exact and exact.get("reviewed") is True:
        log("official_domain", str(exact.get("source", "reviewed registry")), "Exact hostname matches the reviewed official-domain registry")
        category = "very_safe"
        reason = "The exact hostname matches the reviewed official-domain registry. This is not a guarantee about every page or transaction."
    else:
        log("official_domain", "local official-domain registry", "No reviewed exact-hostname match")
        category = "insufficient_evidence"
        reason = "There is not enough verified evidence to classify this website as safe or unsafe."

    registrable = _registrable_guess(hostname)
    page_claim = (title + " " + page_text).casefold()
    suspected_brand: str | None = None
    similar_hosts: list[tuple[str, float, dict[str, Any]]] = []
    for entry in registry_entries:
        if entry.get("reviewed") is not True:
            continue
        official_host = str(entry["hostname"]).lower().strip(".")
        brand = str(entry.get("brand", official_host))
        # Compare the registrable domains, not arbitrary substring matches.
        ratio = difflib.SequenceMatcher(None, registrable, _registrable_guess(official_host)).ratio()
        brand_claimed = bool(brand and re.search(r"(?<!\w)" + re.escape(brand.casefold()) + r"(?!\w)", page_claim))
        if _registrable_guess(hostname) != _registrable_guess(official_host) and hostname != official_host and ratio >= 0.78:
            similar_hosts.append((official_host, ratio, entry))
        if brand_claimed:
            suspected_brand = brand

    if similar_hosts:
        closest_host, score, entry = sorted(similar_hosts, key=lambda item: item[1], reverse=True)[0]
        log("lookalike", "local URL similarity heuristic", f"{hostname} resembles {closest_host} (similarity {score:.2f})", detail="Heuristic only; inspect the domain before proceeding.")
        category = "unsafe" if any(str(form.get("type", "")).lower() in {"password", "password_current", "otp"} for form in forms) else "unsafe"
        reason = f"The hostname resembles a reviewed domain ({closest_host}) but does not match it exactly."
    else:
        log("lookalike", "local URL similarity heuristic", "No reviewed-domain lookalike match")

    sensitive_types = {"password", "password_current", "otp", "payment", "card", "bank_account"}
    sensitive_forms = [form for form in forms if isinstance(form, dict) and str(form.get("type", "")).lower() in sensitive_types]
    form_hosts = {str(form.get("action_host", "")).lower() for form in sensitive_forms if form.get("action_host")}
    if sensitive_forms:
        safe_fields = ", ".join(sorted({str(form.get("type", "unknown")).lower() for form in sensitive_forms}))
        log("sensitive_form", "current-tab DOM metadata", f"Detected sensitive field types: {safe_fields}", detail="Field values are never read; only structural metadata is used.")
        if suspected_brand and not (exact and exact.get("reviewed") is True):
            category = "unsafe"
            reason = f"This page mentions {suspected_brand} and requests sensitive information on a hostname not verified for that brand."
        elif category != "very_safe":
            category = "insufficient_evidence"
            reason = "The page requests sensitive information, but the hostname is not confirmed in the reviewed registry. Treat this as a caution, not proof of fraud."
        if form_hosts and any(host and host != hostname for host in form_hosts):
            log("form_destination", "current-tab form metadata", "A sensitive form action points to a different hostname", detail="Confirm the destination before entering information.")
            category = "unsafe"
            reason = "A sensitive form appears to submit to a different hostname."
    else:
        if forms_available:
            log(
                "sensitive_form",
                "current-tab DOM metadata",
                "No password, OTP or payment field detected in the inspected DOM"
            )
        else:
            log(
                "sensitive_form",
                "not run",
                "Form metadata was not supplied or was not inspected; "
                "sensitive fields could not be assessed",
                status="failed"
            )

    domain_labels = hostname.split(".")
    punycode_present = any(label.startswith("xn--") for label in domain_labels)
    if punycode_present:
        log("idn_hostname", "local IDN normalization", "Hostname contains an IDN/Punycode label", detail="Punycode is not malicious by itself; inspect the intended brand and domain.")
        if category == "insufficient_evidence":
            category = "insufficient_evidence"
            reason = "The hostname contains an internationalized-domain label; inspect it carefully. This alone does not prove fraud."
    else:
        log("idn_hostname", "local IDN normalization", "No Punycode label detected")

    if mode == "pasted_url":
        log("page_content", "not run", "Page not viewed; only address-based checks were performed", status="failed")
    elif snapshot_available:
        log("page_content", "current-tab DOM snapshot", f"Inspected title and up to {len(page_text)} characters of visible text")
    else:
        log(
            "page_content",
            "not run",
            "No current-tab DOM snapshot was supplied; only address-based checks were performed",
            status="failed"
        )
    log("domain_age", "not configured", "Domain registration lookup is not configured", status="failed")
    log("certificate", "not configured", "Certificate details were not supplied by the browser snapshot", status="failed")
    log("reputation_api", "not configured", "No external reputation provider is configured", status="failed")

    not_checked = ["domain registration age", "certificate details", "external threat reputation", "social reviews"]
    risk_notes = ["Risk assessment, not a guarantee.", "No live reputation or domain-age lookup is configured in this starter kit."]
    if not exact or exact.get("reviewed") is not True:
        if category not in {"unsafe", "very_unsafe", "suspicious"}:
            category = "insufficient_evidence"
            reason = "No reviewed official-domain match or threat-intelligence result was available; the site cannot be confirmed safe."
    return _result(category, reason, normalized_url, mode, evidence, risk_notes, not_checked)


def _result(category: str, reason: str, url: str, mode: str, evidence: list[dict[str, Any]], risk_notes: list[str], not_checked: list[str]) -> dict[str, Any]:
    return {
        "category": category,
        "reason": reason,
        "url": url,
        "mode": mode,
        "evidence": evidence,
        "not_checked": not_checked,
        "risk_notes": risk_notes,
        "disclaimer": "Risk assessment, not a guarantee.",
    }
