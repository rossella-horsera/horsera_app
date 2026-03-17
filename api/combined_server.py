"""
Combined server: serves the static Horsera frontend + Cadence API.
This allows both to run from a single URL for testing.
"""

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from anthropic import Anthropic

app = FastAPI(title="Horsera")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Rate limit constants ────────────────────────────────────────────────────

SESSION_LIMIT    = 50   # max messages per session_id
USER_DAILY_LIMIT = 100  # max messages per user_id per calendar day (Supabase)

SESSION_LIMIT_MSG = (
    "You've asked Cadence a lot about this ride! "
    "Save your session and start a new one to continue."
)
DAILY_LIMIT_MSG = (
    "You've had a full day of coaching! "
    "Come back tomorrow after your next ride."
)

# ─── Session counter (in-memory, keyed by session_id) ───────────────────────

_session_counts: dict[str, int] = {}
_session_lock   = threading.Lock()

def _check_session_limit(session_id: str | None) -> None:
    """Raise 429 if session_id has hit SESSION_LIMIT. Increments counter."""
    if not session_id:
        return
    with _session_lock:
        count = _session_counts.get(session_id, 0)
        if count >= SESSION_LIMIT:
            raise HTTPException(
                status_code=429,
                detail={"error": "session_limit", "message": SESSION_LIMIT_MSG},
            )
        _session_counts[session_id] = count + 1

# ─── User daily limit via Supabase cadence_conversations ────────────────────

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

def _supabase_headers() -> dict:
    return {
        "apikey":        SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type":  "application/json",
    }

async def _check_user_daily_limit(user_id: str | None, session_id: str | None) -> None:
    """
    Count today's messages for user_id in cadence_conversations.
    Raises 429 if at or above USER_DAILY_LIMIT.
    Inserts a row to record this message (called only after the limit passes).
    Falls back silently if Supabase is not configured or unreachable.
    """
    if not user_id or not SUPABASE_URL or not SUPABASE_KEY:
        return

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    base  = f"{SUPABASE_URL}/rest/v1/cadence_conversations"

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            # Count today's rows for this user — fetch at most USER_DAILY_LIMIT+1
            resp = await client.get(
                base,
                headers={**_supabase_headers(), "Prefer": "count=exact"},
                params={
                    "user_id":    f"eq.{user_id}",
                    "created_at": f"gte.{today}T00:00:00Z",
                    "select":     "id",
                    "limit":      str(USER_DAILY_LIMIT + 1),
                },
            )
            if resp.status_code == 200:
                rows = resp.json()
                if len(rows) >= USER_DAILY_LIMIT:
                    raise HTTPException(
                        status_code=429,
                        detail={"error": "daily_limit", "message": DAILY_LIMIT_MSG},
                    )

            # Record this message
            await client.post(
                base,
                headers=_supabase_headers(),
                json={
                    "user_id":    user_id,
                    "session_id": session_id,
                },
            )
    except HTTPException:
        raise  # re-raise rate-limit errors
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning(f"[Cadence] Supabase usage check failed: {exc}")

# ─── Legacy anonymous file-based fallback ───────────────────────────────────

USAGE_FILE       = Path("/tmp/cadence_usage.json")
ANON_DAILY_LIMIT = 100

def _load_usage() -> dict:
    if USAGE_FILE.exists():
        return json.loads(USAGE_FILE.read_text())
    return {"daily": {}, "total": 0}

def _check_anon_daily_limit() -> dict:
    usage = _load_usage()
    today = datetime.now().strftime("%Y-%m-%d")
    count = usage["daily"].get(today, 0)
    if count >= ANON_DAILY_LIMIT:
        raise HTTPException(
            status_code=429,
            detail={"error": "daily_limit", "message": DAILY_LIMIT_MSG},
        )
    usage["daily"][today] = count + 1
    usage["total"]        = usage.get("total", 0) + 1
    USAGE_FILE.write_text(json.dumps(usage))
    return {"daily_used": count + 1, "daily_limit": ANON_DAILY_LIMIT, "total": usage["total"]}


# ─── Cadence System Prompt ───────────────────────────────────────────────────

CADENCE_SYSTEM = """You are Cadence — the intelligent, warm, and knowledgeable riding advisor inside Horsera, an AI-powered equestrian rider development platform.

## Your Personality
- Warm but precise. Like the best riding coach who genuinely cares.
- Speak with quiet confidence — never condescending, never overly casual.
- Use equestrian terminology naturally but explain when context helps.
- Be encouraging without being patronizing. Honest about areas that need work.
- Brief and focused — riders want actionable advice, not essays. Keep responses to 2-4 sentences unless the question warrants depth.

## Your Expertise
You deeply understand:
- **Rider Biomechanics**: The 6 Tier-1 metrics:
  1. Lower Leg Stability — ankle drift relative to hip, stirrup pressure consistency
  2. Rein Steadiness — hand movement amplitude, smoothness of contact
  3. Rein Symmetry — left/right balance, drift patterns
  4. Core Stability — torso angle consistency, absorption of horse movement
  5. Upper Body Alignment — shoulder-hip-heel line, forward/backward lean
  6. Pelvis Stability — lateral tilt, rotational consistency, sitting trot absorption

- **USDF Riding Quality Scales**: Rhythm, Relaxation, Contact, Impulsion, Straightness, Balance
- **Dressage Training Levels**: Training through Grand Prix
- **The Causal Chain**: RiderBiomechanics → RidingQuality → Tasks → Levels

## Context About This Rider
Serious amateur working toward Training Level Test 1 in dressage.
Recent biomechanics (from AI video analysis):
- Lower Leg Stability: 72% (improving — was 55% six weeks ago)
- Rein Steadiness: 81% (good, consolidating)
- Rein Symmetry: 68% (right-rein drift pattern)
- Core Stability: 88% (strong — nearly mastered)
- Upper Body Alignment: 75% (slight forward lean in transitions)
- Pelvis Stability: 71% (rightward hip collapse in canter)

Key patterns:
- Right stirrup loss correlates with right hip collapse
- Core strength is the strongest foundation
- Transitions are where position breaks down most

Horse: Allegra (14.3hh mare, forward but sensitive, prefers steady contact)

## Response Guidelines
- Reference specific biomechanics data when relevant
- Connect biomechanics to riding quality to practical outcomes
- Suggest specific exercises when appropriate
- Be honest about limits of your knowledge
- Keep language warm and supportive but professional — luxury brand"""


# ─── API Models ──────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages:   list[ChatMessage]
    riderName:  str | None = None
    session_id: str | None = None  # tracks per-session limit (50 msgs)
    user_id:    str | None = None  # tracks per-user daily limit (100 msgs)


# ─── Endpoints ───────────────────────────────────────────────────────────────

client = Anthropic()

@app.post("/api/cadence/chat")
async def cadence_chat(request: ChatRequest):
    # ① Session limit (in-memory, synchronous)
    _check_session_limit(request.session_id)

    # ② User daily limit (Supabase) — or anonymous fallback
    if request.user_id:
        await _check_user_daily_limit(request.user_id, request.session_id)
        usage_stats: dict = {}
    else:
        usage_stats = _check_anon_daily_limit()

    api_messages = [
        {"role": "user" if m.role == "user" else "assistant", "content": m.content}
        for m in request.messages
    ]

    def generate():
        try:
            with client.messages.stream(
                model="claude-haiku-4-5-20251001",
                max_tokens=512,
                system=CADENCE_SYSTEM,
                messages=api_messages,
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'type': 'text', 'text': text})}\n\n"
            if usage_stats:
                yield f"data: {json.dumps({'type': 'usage', **usage_stats})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

@app.get("/api/cadence/usage")
async def get_usage():
    usage = _load_usage()
    today = datetime.now().strftime("%Y-%m-%d")
    return {
        "daily_used":  usage["daily"].get(today, 0),
        "daily_limit": ANON_DAILY_LIMIT,
        "total":       usage.get("total", 0),
    }

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "horsera"}


# ─── Static files (must be last) ─────────────────────────────────────────────

DIST_DIR = Path(__file__).parent.parent / "dist"
if DIST_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(DIST_DIR / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = DIST_DIR / full_path
        if file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(DIST_DIR / "index.html"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)
