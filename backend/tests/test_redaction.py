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
