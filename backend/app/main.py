"""Bharosa local backend starter. Run from backend/: uvicorn app.main:app --host 127.0.0.1 --port 8765"""
from __future__ import annotations

import time
import uuid
from typing import Any

import httpx
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .ai import OLLAMA_MODEL, OLLAMA_URL, detect_contextual_entities, model_configured
from .redaction import apply_redactions, detect_pii, findings_from_model, verify_redaction
from .security import ALLOWED_ORIGINS, API_TOKEN, OriginGuardMiddleware, require_token, validate_local_model_url
from .site_check import check_site

app = FastAPI(title="Bharosa Local API", version="0.1.0", docs_url=None, redoc_url=None)
app.add_middleware(OriginGuardMiddleware, allowed_origins=ALLOWED_ORIGINS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(ALLOWED_ORIGINS),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Bharosa-Token"],
)

# Deliberately in-memory only. Do not add persistent storage or content logging.
SESSIONS: dict[str, dict[str, Any]] = {}
SESSION_TTL_SECONDS = 30 * 60
MAX_TEXT_CHARS = 500_000

print("\n[Bharosa] API token for this local backend (paste into the extension):")
print(f"{API_TOKEN}\n")
if not ALLOWED_ORIGINS:
    print("[Bharosa] WARNING: BHAROSA_ALLOWED_ORIGINS is empty; browser-extension requests will be rejected.")


class RedactStartRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=240)
    content: str = Field(max_length=MAX_TEXT_CHARS)


class RedactUpdateRequest(BaseModel):
    session_id: str
    decisions: dict[str, bool] = Field(default_factory=dict)
    additions: list[dict[str, str]] = Field(default_factory=list, max_length=100)


class SessionRequest(BaseModel):
    session_id: str


class ExportRequest(BaseModel):
    session_id: str
    format: str = Field(pattern="^(txt|md)$")


class SiteCheckRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    mode: str = Field(default="current_tab", pattern="^(current_tab|pasted_url)$")
    page_snapshot: dict[str, Any] | None = None
    social_search: bool = False


def _cleanup_sessions() -> None:
    now = time.time()
    expired = [sid for sid, value in SESSIONS.items() if now - value["created_at"] > SESSION_TTL_SECONDS]
    for sid in expired:
        SESSIONS.pop(sid, None)


def _get_session(session_id: str) -> dict[str, Any]:
    _cleanup_sessions()
    session = SESSIONS.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session expired or not found. Upload the document again.")
    return session


def _set_redacted_preview(session: dict[str, Any]) -> None:
    redacted, mapping = apply_redactions(session["original_text"], session["findings"])
    session["redacted_text"] = redacted
    # Mapping stays in memory only and is never returned by the API.
    session["placeholder_mapping"] = mapping
    session["verification"] = None


@app.get("/health")
async def health() -> dict[str, Any]:
    model_status = "not_configured"
    if model_configured():
        try:
            local_model_base = validate_local_model_url(OLLAMA_URL)
        except ValueError:
            model_status = "invalid_local_model_url"
        else:
            try:
                async with httpx.AsyncClient(timeout=1.2, trust_env=False) as client:
                    response = await client.get(local_model_base + "/api/tags")
                if response.status_code != 200:
                    model_status = "unavailable"
                else:
                    installed = [item.get("name", "") for item in response.json().get("models", [])]
                    model_status = "reachable" if OLLAMA_MODEL in installed else "model_not_found"
            except (httpx.HTTPError, ValueError, TypeError):
                model_status = "unavailable"
    return {
        "status": "ok",
        "service": "bharosa-local-api",
        "model": {"configured": model_configured(), "name": OLLAMA_MODEL or None, "status": model_status},
        "storage": "memory-only prototype sessions",
    }


@app.post("/redact/start", dependencies=[Depends(require_token)])
async def redact_start(request: RedactStartRequest) -> dict[str, Any]:
    suffix = request.filename.lower().rsplit(".", 1)[-1] if "." in request.filename else ""
    if suffix not in {"txt", "md", "markdown"}:
        raise HTTPException(status_code=415, detail="This starter supports text-based .txt and .md files only. PDF and scanned documents are not supported yet.")
    if not request.content.strip():
        raise HTTPException(status_code=422, detail="The file is empty or contains no readable text.")

    findings = detect_pii(request.content)
    fixed_values = [item["value"] for item in findings]
    model_status = "not_configured"
    model_candidates: list[dict[str, Any]] = []
    if model_configured():
        raw_candidates, model_status = await detect_contextual_entities(request.content, fixed_values)
        model_candidates = findings_from_model(request.content, raw_candidates)
        known = {(item["type"], item["value"].casefold()) for item in findings}
        for item in model_candidates:
            key = (item["type"], item["value"].casefold())
            if key not in known and not any(existing["value"].casefold() == item["value"].casefold() for existing in findings):
                findings.append(item)
                known.add(key)

    session_id = str(uuid.uuid4())
    SESSIONS[session_id] = {
        "created_at": time.time(),
        "filename": request.filename,
        "original_text": request.content,
        "findings": findings,
        "redacted_text": request.content,
        "placeholder_mapping": {},
        "verification": None,
        "has_reviewed": False,
    }
    return {
        "session_id": session_id,
        "filename": request.filename,
        "findings": findings,
        "counts_by_type": {kind: sum(1 for item in findings if item["type"] == kind) for kind in sorted({item["type"] for item in findings})},
        "model_status": model_status,
        "message": "Review every proposed finding. Nothing is redacted until you apply your decisions.",
    }


@app.post("/redact/update", dependencies=[Depends(require_token)])
async def redact_update(request: RedactUpdateRequest) -> dict[str, Any]:
    session = _get_session(request.session_id)
    by_id = {item["id"]: item for item in session["findings"]}
    for finding_id, approved in request.decisions.items():
        if finding_id in by_id:
            by_id[finding_id]["approved"] = bool(approved)
    for addition in request.additions:
        value = addition.get("value", "").strip()
        kind = addition.get("type", "other").strip() or "other"
        if not value or len(value) > 300 or value.casefold() not in session["original_text"].casefold():
            continue
        if any(item["value"].casefold() == value.casefold() and item["type"] == kind for item in session["findings"]):
            continue
        session["findings"].append({
            "id": str(uuid.uuid4()), "value": value, "type": kind, "source": "user",
            "occurrences": session["original_text"].casefold().count(value.casefold()),
            "approved": True, "reason": "Added by the user for redaction.",
        })
    session["has_reviewed"] = True
    _set_redacted_preview(session)
    return {
        "session_id": request.session_id,
        "findings": session["findings"],
        "redacted_preview": session["redacted_text"],
        "approved_count": sum(1 for item in session["findings"] if item["approved"]),
    }


@app.post("/redact/verify", dependencies=[Depends(require_token)])
async def redact_verify(request: SessionRequest) -> dict[str, Any]:
    session = _get_session(request.session_id)
    if not session.get("has_reviewed"):
        result = {
            "status": "fail",
            "problems": [{"type": "review_required", "detail": "Review the findings and submit your decisions before verification."}],
            "risk_notes": ["No export is allowed until a review decision has been submitted."],
            "understandable": True,
            "amounts_unchanged": False,
            "iso_dates_unchanged": False,
        }
        session["verification"] = result
        return {**result, "redacted_preview": session["original_text"], "approved_count": 0}
    _set_redacted_preview(session)
    result = verify_redaction(session["original_text"], session["redacted_text"], session["findings"])
    session["verification"] = result
    return {**result, "redacted_preview": session["redacted_text"], "approved_count": sum(1 for item in session["findings"] if item["approved"])}


@app.post("/redact/export", dependencies=[Depends(require_token)])
async def redact_export(request: ExportRequest) -> Response:
    session = _get_session(request.session_id)
    verification = session.get("verification")
    if not session.get("has_reviewed") or not verification or verification.get("status") != "pass":
        raise HTTPException(status_code=409, detail="Review findings and complete a passing verification before exporting.")
    content = session["redacted_text"].encode("utf-8")
    media_type = "text/markdown; charset=utf-8" if request.format == "md" else "text/plain; charset=utf-8"
    # Neutral name: never reuse a potentially sensitive original filename.
    safe_name = "bharosa-redacted." + request.format
    SESSIONS.pop(request.session_id, None)
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{safe_name}"', "Cache-Control": "no-store"})


@app.post("/redact/clear", dependencies=[Depends(require_token)])
async def redact_clear(request: SessionRequest) -> dict[str, bool]:
    SESSIONS.pop(request.session_id, None)
    return {"cleared": True}


@app.post("/site/check", dependencies=[Depends(require_token)])
async def site_check(request: SiteCheckRequest) -> dict[str, Any]:
    try:
        payload = request.model_dump()
        result = check_site(payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return result
