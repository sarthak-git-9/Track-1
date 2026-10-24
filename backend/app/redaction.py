"""Deterministic PII candidate detection and code-owned replacement.

The detector suggests candidates. It never edits the source document. Replacement
is done only after user approval, which keeps the local model out of the edit path.
"""
from __future__ import annotations

import re
import uuid
from collections import defaultdict
from typing import Any

# Use only synthetic fixtures in tests and demonstrations. All regex matches are
# candidates for user review; pattern matches are not proof that a value is valid.
_PATTERNS: list[tuple[str, re.Pattern[str], int]] = [
    ("upi", re.compile(r"(?<![\w.+-])[A-Z0-9._-]{2,}@(okaxis|okicici|oksbi|okhdfcbank|ybl|ibl|paytm|apl|upi|axisbank|sbi|hdfcbank)(?!(?:[\w-]|\.\w))", re.I), 0),
    ("email", re.compile(r"\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+\b", re.I), 1),
    ("card", re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)"), 2),
    ("phone", re.compile(r"(?<!\w)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\w)"), 3),
    ("pan", re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b", re.I), 4),
    ("ifsc", re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b", re.I), 5),
    ("aadhaar_candidate", re.compile(r"(?<!\d)(?:\d[ -]?){11}\d(?!\d)"), 6),
]
_ACCOUNT_RE = re.compile(r"\b(?:bank\s+)?(?:account|acct|a/c)\s*(?:(?:number|no\.?|#)\s*)?[:=\-]?\s*(\d{9,18})\b", re.I)
_DOB_RE = re.compile(r"\b(?:date of birth|dob|birth date)\s*[:=\-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b", re.I)


def luhn_valid(number: str) -> bool:
    digits = [int(ch) for ch in number if ch.isdigit()]
    if not 13 <= len(digits) <= 19:
        return False
    checksum = 0
    parity = len(digits) % 2
    for index, digit in enumerate(digits):
        if index % 2 == parity:
            digit *= 2
            if digit > 9:
                digit -= 9
        checksum += digit
    return checksum % 10 == 0


def _canonical(value: str, kind: str = "other") -> str:
    """Normalize only presentation separators that are insignificant by type."""
    if kind in {"card", "aadhaar_candidate", "phone", "account"}:
        return re.sub(r"[\s-]+", "", value)
    if kind in {"email", "upi"}:
        # Email local parts and UPI handles are case-insensitive for this app,
        # but punctuation and all other characters remain meaningful.
        return value.casefold()
    if kind in {"pan", "ifsc"}:
        return value.casefold()
    return value


def _pattern_for_kind(kind: str, value: str) -> re.Pattern[str]:
    """Build a type-constrained matcher for approved identifier variants."""
    escaped = re.escape(value)
    if kind in {"card", "aadhaar_candidate", "phone", "account"}:
        digits = re.sub(r"\D", "", value)
        if not digits:
            return re.compile(r"(?!)")
        # Permit only the known insignificant separators between digits. This
        # prevents a match from spanning punctuation or unrelated document text.
        body = r"[\s-]*".join(re.escape(digit) for digit in digits)
        country_prefix = r"\+\s*" if kind == "phone" and value.lstrip().startswith("+") else ""
        return re.compile(rf"(?<!\d){country_prefix}{body}(?!\d)")
    return re.compile(escaped, re.I if kind in {"email", "upi", "pan", "ifsc"} else 0)


def _placeholder_for(item: dict[str, Any], findings: list[dict[str, Any]]) -> str:
    kind = str(item.get("type", "other"))
    approved = [entry for entry in findings if entry.get("approved") is True and isinstance(entry.get("value"), str)]
    approved.sort(key=lambda entry: len(entry["value"]), reverse=True)
    counters: defaultdict[str, int] = defaultdict(int)
    seen: set[tuple[str, str]] = set()
    for entry in approved:
        entry_kind = str(entry.get("type", "other"))
        key = (entry_kind, _canonical(entry["value"], entry_kind))
        if key in seen:
            continue
        seen.add(key)
        counters[entry_kind] += 1
        label = {
            "person": "PERSON", "address": "ADDRESS", "organization": "ORG",
            "payee": "PERSON", "email": "EMAIL", "phone": "PHONE", "card": "CARD",
            "account": "ACCOUNT", "pan": "ID", "aadhaar_candidate": "ID",
            "ifsc": "IFSC", "upi": "UPI", "date_of_birth": "DOB", "other": "ENTITY",
        }.get(entry_kind, "ENTITY")
        if entry_kind == kind and key == (kind, _canonical(str(item["value"]), kind)):
            return f"[{label}_{counters[entry_kind]}]"
    return "[ENTITY_1]"


def detect_pii(text: str) -> list[dict[str, Any]]:
    """Return deduplicated PII candidates with occurrence counts.

    Overlapping matches are resolved by pattern priority. Aadhaar-shaped values
    are deliberately tagged as candidates rather than claimed as verified IDs;
    checksum validation should be added before treating them as high confidence.
    """
    raw: list[tuple[int, int, str, str, int]] = []
    for kind, pattern, priority in _PATTERNS:
        for match in pattern.finditer(text):
            value = match.group(0).strip()
            if kind == "card" and not luhn_valid(value):
                continue
            if kind == "phone":
                digits = re.sub(r"\D", "", value)
                if len(digits) not in {10, 12}:
                    continue
            if kind == "aadhaar_candidate":
                digits = re.sub(r"\D", "", value)
                if len(digits) != 12 or digits[0] in "0 1":
                    continue
            raw.append((match.start(), match.end(), value, kind, priority))
    for match in _ACCOUNT_RE.finditer(text):
        value = match.group(1)
        raw.append((match.start(1), match.end(1), value, "account", 1))
    for match in _DOB_RE.finditer(text):
        value = match.group(1)
        raw.append((match.start(1), match.end(1), value, "date_of_birth", 1))

    # Keep non-overlapping candidates, preferring explicit/validated patterns.
    raw.sort(key=lambda item: (item[4], -(item[1] - item[0]), item[0]))
    chosen: list[tuple[int, int, str, str, int]] = []
    for item in raw:
        start, end = item[0], item[1]
        if any(start < old_end and end > old_start for old_start, old_end, *_ in chosen):
            continue
        chosen.append(item)
    chosen.sort(key=lambda item: item[0])

    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for start, end, value, kind, _priority in chosen:
        key = (kind, _canonical(value, kind))
        if key not in grouped:
            grouped[key] = {
                "id": str(uuid.uuid4()), "value": value, "type": kind,
                "source": "deterministic", "occurrences": 0,
                "approved": False,
                "reason": "Matched a local pattern; review before redacting.",
            }
        grouped[key]["occurrences"] += 1
    return list(grouped.values())


def findings_from_model(text: str, model_findings: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Validate candidate values emitted by an optional local model."""
    validated: list[dict[str, Any]] = []
    allowed_types = {"person", "address", "payee", "organization", "other"}
    for raw in model_findings or []:
        value = raw.get("text")
        kind = raw.get("type", "other")
        if not isinstance(value, str) or not value.strip() or kind not in allowed_types:
            continue
        value = value.strip()
        if value not in text:
            continue
        validated.append({
            "id": str(uuid.uuid4()), "value": value, "type": kind,
            "source": "local_model", "occurrences": len(re.findall(re.escape(value), text, re.I)),
            "approved": False,
            "reason": str(raw.get("reason", "Contextual candidate from the local model."))[:240],
        })
    return validated


def apply_redactions(original_text: str, findings: list[dict[str, Any]]) -> tuple[str, dict[str, str]]:
    """Replace user-approved values in code; map originals only in memory."""
    approved = [item for item in findings if item.get("approved") is True and isinstance(item.get("value"), str) and item["value"]]
    approved.sort(key=lambda item: len(item["value"]), reverse=True)
    placeholders: dict[tuple[str, str], str] = {}
    originals_to_placeholders: dict[str, str] = {}
    counters: defaultdict[str, int] = defaultdict(int)
    output = original_text
    for item in approved:
        value = item["value"]
        kind = item.get("type", "other")
        key = (kind, _canonical(value, kind))
        if key not in placeholders:
            counters[kind] += 1
            label = {
                "person": "PERSON", "address": "ADDRESS", "organization": "ORG",
                "payee": "PERSON", "email": "EMAIL", "phone": "PHONE", "card": "CARD",
                "account": "ACCOUNT", "pan": "ID", "aadhaar_candidate": "ID",
                "ifsc": "IFSC", "upi": "UPI", "date_of_birth": "DOB", "other": "ENTITY",
            }.get(kind, "ENTITY")
            placeholders[key] = f"[{label}_{counters[kind]}]"
        placeholder = placeholders[key]
        originals_to_placeholders[value] = placeholder
        output = _pattern_for_kind(kind, value).sub(lambda _m, p=placeholder: p, output)
    return output, originals_to_placeholders


def verify_redaction(original_text: str, redacted_text: str, findings: list[dict[str, Any]], *, max_rounds: int = 3) -> dict[str, Any]:
    """Independently rescan output and make at most three safe repair passes.

    The return value never includes identifier contents. ``rounds`` records how
    many scan/repair rounds were used; a remaining leak always fails closed.
    """
    approved = [item for item in findings if item.get("approved") is True and item.get("value")]
    output = redacted_text
    rounds = max(1, min(int(max_rounds), 3))
    rounds_used = 0
    residual_types: set[str] = set()
    for _round in range(rounds):
        rounds_used += 1
        found = False
        for item in approved:
            kind = str(item.get("type", "other"))
            pattern = _pattern_for_kind(kind, str(item["value"]))
            if pattern.search(output):
                found = True
                output = pattern.sub(lambda _m: _placeholder_for(item, findings), output)
        # Independently detect PII-shaped candidates too. Only fail for an
        # output candidate matching an approved canonical identifier.
        approved_keys = {(str(item.get("type", "other")), _canonical(str(item["value"]), str(item.get("type", "other")))) for item in approved}
        for candidate in detect_pii(output):
            key = (candidate["type"], _canonical(candidate["value"], candidate["type"]))
            if key in approved_keys:
                found = True
                residual_types.add(candidate["type"])
        if not found:
            break
    # Final independent scan, after the retry budget, decides pass/fail.
    for item in approved:
        kind = str(item.get("type", "other"))
        if _pattern_for_kind(kind, str(item["value"])).search(output):
            residual_types.add(kind)
    approved_keys = {(str(item.get("type", "other")), _canonical(str(item["value"]), str(item.get("type", "other")))) for item in approved}
    for candidate in detect_pii(output):
        if (candidate["type"], _canonical(candidate["value"], candidate["type"])) in approved_keys:
            residual_types.add(candidate["type"])
    # Basic integrity guard for common currency amounts and ISO dates; review notes
    # are advisory because formatting can be changed intentionally by a user.
    amount_pattern = re.compile(r"(?:₹|INR\s*)\s?\d[\d,]*(?:\.\d{1,2})?", re.I)
    date_pattern = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
    original_amounts = amount_pattern.findall(original_text)
    original_dates = date_pattern.findall(original_text)
    integrity_ok = original_amounts == amount_pattern.findall(output) and original_dates == date_pattern.findall(output)
    leaks = [{"type": kind, "detail": "An approved identifier remains after verification."} for kind in sorted(residual_types)]
    return {
        "status": "pass" if not leaks and integrity_ok else "fail",
        "problems": leaks + ([] if integrity_ok else [{"type": "integrity", "detail": "Some currency amounts or ISO dates changed; inspect the preview."}]),
        "risk_notes": ["Detection is best-effort; review the output before sharing."],
        "understandable": True,
        "amounts_unchanged": original_amounts == amount_pattern.findall(output),
        "iso_dates_unchanged": original_dates == date_pattern.findall(output),
        "rounds": rounds_used,
        "redacted_text": output,
    }
