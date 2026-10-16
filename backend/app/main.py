"""FastAPI application entry point.

Run locally from the `backend/` directory:

    uvicorn app.main:app --reload --port 8000

Interactive API documentation is then served at
http://localhost:8000/docs
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.api.routes import app_platform
from app.core.config import get_settings
from app.core.json_only import JsonOnlyMiddleware
from app.services.tube import TubeError

settings = get_settings()

# Refused here, at startup, rather than on the first member's request:
# a real provider selected without its key (CLAUDE.md section 19), a
# deployed server left in development mode, or a deployed server whose
# ADMIN_PASSWORD is a known default (prep-beta-launch, Launch data rules).
# With every provider on mock and APP_ENV=development, nothing is required.
_problems = settings.startup_problems()
if _problems:
    raise RuntimeError("Refusing to start: " + " | ".join(_problems))

# The interactive API docs (/docs, /redoc, /openapi.json) exist only in
# development. On a deployed server they would list every route to anyone
# who asked; nothing there needs them, and the browser reaches the API only
# through the Next.js /api/* rewrite anyway.
_docs = settings.is_development

app = FastAPI(
    title="Ctrl AI Backend",
    version="0.1.0",
    description="Core API for the Ctrl AI community platform.",
    docs_url="/docs" if _docs else None,
    redoc_url="/redoc" if _docs else None,
    openapi_url="/openapi.json" if _docs else None,
)

# A browser refuses to read a response from a different origin unless that
# origin explicitly allows it. The frontend runs on http://localhost:3000
# and the backend on http://localhost:8000 — different ports mean
# different origins — so the allowed origins are listed explicitly.
# Never use `allow_origins=["*"]` once authentication cookies exist.
# Every POST must carry a non-simple Content-Type, so a page on another
# origin — a member app on apps.ctrlai.my is same-site — cannot send one
# without a preflight, which the CORS list below refuses (CLAUDE.md §2).
# Added first, so it sits inside CORS.
app.add_middleware(JsonOnlyMiddleware)

# apps.ctrlai.my must never be in this list: `Settings.startup_problems`
# refuses to start if it is.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.exception_handler(TubeError)
async def _tube_error(_: Request, error: TubeError) -> JSONResponse:
    """CtrlAITube's service errors carry their status; one handler, not a
    try/except per route (promo-videos)."""
    return JSONResponse(status_code=error.status_code, content={"detail": str(error)})

# The apps origin's own routes (app-platform), outside /api: only Caddy's
# apps.<domain> block reaches them; the club's site forwards /api/* only.
app.include_router(app_platform.router)
app.include_router(app_platform.callback_router)


@app.get("/", tags=["meta"], summary="Service banner")
def root() -> dict[str, str]:
    """Tiny response so hitting the bare URL confirms the server is up."""
    banner = {"service": "ctrl-ai-backend", "health": "/api/health"}
    if _docs:
        banner["docs"] = "/docs"
    return banner
