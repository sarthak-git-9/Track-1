import app.redaction as redaction
from app.redaction import apply_redactions, detect_pii, luhn_valid, verify_redaction


def test_luhn_accepts_public_test_card_number():
    # Public payment-provider test fixture, not a real cardholder credential.
    assert luhn_valid("4111111111111111") is True


def test_detector_finds_email_card_and_upi_without_auto_approving():
    text = "Contact alice@example.test; test card 4111111111111111; UPI demo-user@okaxis."
    findings = detect_pii(text)
    types = {item["type"] for item in findings}
    assert "email" in types
    assert "card" in types
    assert "upi" in types
    assert all(item["approved"] is False for item in findings)


def test_apply_and_verify_replaces_only_approved_findings():
    text = "Email alice@example.test paid INR 1,250.00 on 2026-10-25 using card 4111111111111111."
    findings = detect_pii(text)
    for item in findings:
        item["approved"] = item["type"] in {"email", "card"}
    redacted, mapping = apply_redactions(text, findings)
    assert "alice@example.test" not in redacted
    assert "4111111111111111" not in redacted
    assert "INR 1,250.00" in redacted
    assert "2026-10-25" in redacted
    assert mapping
    result = verify_redaction(text, redacted, findings)
    assert result["status"] == "pass"


def test_unapproved_finding_is_not_replaced():
    text = "Email alice@example.test"
    findings = detect_pii(text)
    redacted, _ = apply_redactions(text, findings)
    assert redacted == text


def test_approved_card_replaces_space_and_hyphen_variants_consistently():
    text = "Card 4111 1111 1111 1111; same card 4111-1111-1111-1111."
    findings = detect_pii(text)
    cards = [item for item in findings if item["type"] == "card"]
    assert len(cards) == 1
    cards[0]["approved"] = True
    redacted, _ = apply_redactions(text, findings)
    assert redacted.count("[CARD_1]") == 2
    result = verify_redaction(text, redacted, findings)
    assert result["status"] == "pass"
    assert result["amounts_unchanged"] and result["iso_dates_unchanged"]


def test_verifier_reports_residual_without_returning_sensitive_value(monkeypatch):
    text = "Synthetic account card 4111 1111 1111 1111, INR 25.00 on 2026-10-25."
    findings = detect_pii(text)
    for item in findings:
        item["approved"] = item["type"] == "card"
    # Simulate a repair pass that cannot remove a persistent residual.
    monkeypatch.setattr(redaction, "_placeholder_for", lambda item, _findings: item["value"])
    result = verify_redaction(text, text, findings, max_rounds=99)
    assert result["status"] == "fail"
    assert result["rounds"] == 3
    assert any(problem["type"] == "card" for problem in result["problems"])
    assert all("4111" not in str(problem) for problem in result["problems"])
    assert result["amounts_unchanged"] and result["iso_dates_unchanged"]


def test_meaningful_email_and_upi_differences_remain_distinct():
    text = "alice-smith@example.test alice_smith@example.test alice-smith@okaxis alice_smith@okaxis"
    findings = detect_pii(text)
    emails = [item for item in findings if item["type"] == "email"]
    upis = [item for item in findings if item["type"] == "upi"]
    assert len(emails) == 2
    assert len(upis) == 2
