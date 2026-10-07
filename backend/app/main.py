"""FastAPI application entry point.

Run locally from the `backend/` directory:

    uvicorn app.main:app --reload --port 8000

Interactive API documentation is then served at
http://localhost:8000/docs
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings

settings = get_settings()

# A real provider selected without its key or model is refused here, at
# startup, rather than on the first member's message (CLAUDE.md section
# 19). With every provider on mock — the default — nothing is required.
_missing = settings.missing_provider_settings()
if _missing:
    raise RuntimeError(
        "A real provider is selected but these settings are missing: " + ", ".join(_missing)
    )

app = FastAPI(
    title="Ctrl AI Backend",
    version="0.1.0",
    description="Core API for the Ctrl AI community platform.",
)

# A browser refuses to read a response from a different origin unless that
# origin explicitly allows it. The frontend runs on http://localhost:3000
# and the backend on http://localhost:8000 — different ports mean
# different origins — so the allowed origins are listed explicitly.
# Never use `allow_origins=["*"]` once authentication cookies exist.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/", tags=["meta"], summary="Service banner")
def root() -> dict[str, str]:
    """Tiny response so hitting the bare URL confirms the server is up."""
    return {"service": "ctrl-ai-backend", "docs": "/docs", "health": "/api/health"}
