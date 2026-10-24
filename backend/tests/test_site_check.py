import json

import pytest

from app import site_check


def test_normalize_url_adds_https_and_normalizes_hostname():
    normalized, hostname = site_check.normalize_url("Example.COM/path")
    assert normalized == "https://example.com/path"
    assert hostname == "example.com"


def test_rejects_embedded_credentials():
    with pytest.raises(ValueError, match="embedded usernames or passwords"):
        site_check.normalize_url("https://user:password@example.com/login")


def test_exact_match_uses_reviewed_registry_not_substring(monkeypatch, tmp_path):
    registry = tmp_path / "official_domains.json"
    registry.write_text(json.dumps([{
        "hostname": "trusted.example",
        "brand": "Trusted Bank",
        "source": "synthetic test fixture",
        "reviewed": True,
    }]), encoding="utf-8")
    monkeypatch.setattr(site_check, "OFFICIAL_REGISTRY_PATH", registry)
    exact = site_check.check_site({"url": "https://trusted.example", "mode": "pasted_url"})
    deceptive = site_check.check_site({"url": "https://trusted.example.attacker.example", "mode": "pasted_url"})
    assert exact["category"] == "very_safe"
    assert "official-domain registry" in exact["reason"]
    assert deceptive["category"] == "insufficient_evidence"
    assert "No reviewed exact-hostname match" in next(x["result"] for x in deceptive["evidence"] if x["check"] == "official_domain")


def test_lookalike_raises_warning(monkeypatch, tmp_path):
    registry = tmp_path / "official_domains.json"
    registry.write_text(json.dumps([{
        "hostname": "trusted.example",
        "brand": "Trusted Bank",
        "source": "synthetic test fixture",
        "reviewed": True,
    }]), encoding="utf-8")
    monkeypatch.setattr(site_check, "OFFICIAL_REGISTRY_PATH", registry)
    result = site_check.check_site({"url": "https://trusfed.example", "mode": "pasted_url"})
    assert result["category"] == "unsafe"
    assert any(item["check"] == "lookalike" for item in result["evidence"])

def test_google_www_control_matches_reviewed_registry_and_pasted_url_has_no_dom_claim():
    result = site_check.check_site({
        "url": "https://www.google.com/",
        "mode": "pasted_url",
    })
    assert result["category"] == "very_safe"
    official = next(e for e in result["evidence"]
                    if e["check"] == "official_domain")
    assert "Exact hostname matches" in official["result"]

    forms = next(e for e in result["evidence"]
                 if e["check"] == "sensitive_form")
    assert forms["status"] == "failed"
    assert "could not be assessed" in forms["result"]

    page = next(e for e in result["evidence"]
                if e["check"] == "page_content")
    assert page["status"] == "failed"


def test_current_tab_without_snapshot_does_not_claim_dom_was_inspected():
    result = site_check.check_site({
        "url": "https://unlisted.example",
        "mode": "current_tab",
    })
    forms = next(e for e in result["evidence"]
                 if e["check"] == "sensitive_form")
    page = next(e for e in result["evidence"]
                if e["check"] == "page_content")
    assert forms["status"] == "failed"
    assert page["status"] == "failed"
