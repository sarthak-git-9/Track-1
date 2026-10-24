"""Local-only API security helpers for the Bharosa prototype."""
from __future__ import annotations

import hmac
import os
import secrets
from urllib.parse import urlparse

from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

API_TOKEN = os.getenv("BHAROSA_API_TOKEN") or secrets.token_urlsafe(32)
_ALLOWED_ORIGINS_RAW = os.getenv("BHAROSA_ALLOWED_ORIGINS", "")
ALLOWED_ORIGINS = {item.strip() for item in _ALLOWED_ORIGINS_RAW.split(",") if item.strip()}

# A browser extension must be explicitly allow-listed. Requests without Origin are
# allowed for local CLI/tests but still require the token on protected routes.
class OriginGuardMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, allowed_origins: set[str]):
        super().__init__(app)
        self.allowed_origins = allowed_origins

    async def dispatch(self, request: Request, call_next):
        origin = request.headers.get("origin")
        if origin and origin not in self.allowed_origins:
            return JSONResponse(status_code=403, content={"detail": "Origin not allowed. Configure BHAROSA_ALLOWED_ORIGINS for this extension."})
        return await call_next(request)


def require_token(request: Request) -> None:
    supplied = request.headers.get("X-Bharosa-Token", "")
    if not supplied or not hmac.compare_digest(supplied, API_TOKEN):
        raise HTTPException(status_code=401, detail="Missing or invalid Bharosa session token")


def validate_local_model_url(url: str) -> str:
    """Disallow sending document text to a remote model endpoint."""
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("The model endpoint must be on localhost. Remote model endpoints are disabled.")
    return url.rstrip("/")
