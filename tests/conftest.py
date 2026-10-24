"""Shared pytest fixtures for Bharosa's document-redaction workflow.

The inspected repository currently contains no application modules, schemas,
dependency manifest, or existing test suite. These fixtures therefore use
schema-neutral synthetic text.

Verification-result fixtures are deferred until the actual verification
contract is available. Guessing that contract could encode unsafe approval
behaviour into future tests.

All person-like values are fictional test data.
"""

import pytest


@pytest.fixture
def synthetic_document_text() -> str:
    """A document excerpt containing synthetic contact PII."""
    return (
        "Account holder: Riley Example\n"
        "Email: riley.example@example.test\n"
        "Phone: +1-202-555-0147\n"
        "Statement note: Monthly service fee is ₹125.00.\n"
    )


@pytest.fixture
def expected_redacted_text() -> str:
    """Illustrative expected output for a configured redaction policy."""
    return (
        "Account holder: [REDACTED_NAME]\n"
        "Email: [REDACTED_EMAIL]\n"
        "Phone: [REDACTED_PHONE]\n"
        "Statement note: Monthly service fee is ₹125.00.\n"
    )


@pytest.fixture
def document_without_pii() -> str:
    """Ordinary document text intended not to contain personal identifiers."""
    return (
        "Quarterly summary\n"
        "Total operating expenses were ₹1,234.56.\n"
        "The reporting period ends on 30 April.\n"
    )


@pytest.fixture
def malformed_model_response() -> str:
    """Malformed JSON for deterministic response-parser error tests."""
    return '{"decision": "approve", "checks": [}'
