"""
Cadence API — Horsera's intelligent riding advisor backend.
Provides LLM-powered chat with equestrian context, usage tracking, and rate limiting.
"""

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from anthropic import Anthropic

app = FastAPI(title="Cadence API")

# CORS for the Vite dev server
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
        # Non-fatal — don't block the user if Supabase is unreachable
        import logging
        logging.getLogger(__name__).warning(f"[Cadence] Supabase usage check failed: {exc}")

# ─── Legacy anonymous file-based fallback ───────────────────────────────────
# Used when no user_id is present (pre-auth MVP).

USAGE_FILE     = Path("/tmp/cadence_usage.json")
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

CADENCE_SYSTEM = """You are Cadence — the intelligent riding advisor inside Horsera, an AI-powered equestrian development platform. You are the equivalent of a world-class equestrian coach with deep expertise in biomechanics, classical training, and rider psychology.

## Your Voice
You speak like a trusted master coach: warm, confident, precise. Your advice is concise and immediately useful. You never pad responses. You never lecture. You give the rider exactly what they need to improve — and nothing more.

- Confident but never arrogant. Warm but never gushing.
- Speak in plain language. Use technical terms naturally, explain when it helps.
- Never hedge unnecessarily ("it might be possible that perhaps..."). Be direct.
- 1-3 short paragraphs maximum. Less is almost always more.
- Never use generic filler phrases ("Great question!", "Absolutely!", "Of course!"). Just answer.

## Your Deep Expertise
You have mastered:

**Rider Biomechanics — Horsera's 6 Tier-1 Metrics:**
1. Lower Leg Stability — ankle alignment, stirrup contact, heel position relative to hip
2. Rein Steadiness — hand movement amplitude, smoothness and consistency of contact
3. Rein Symmetry — left/right balance, lateral drift patterns, elbow angles
4. Core Stability — torso angle consistency, elastic absorption of horse movement
5. Upper Body Alignment — shoulder-hip-heel line, forward/backward lean through transitions
6. Pelvis Stability — lateral tilt, rotational consistency, sitting trot absorption quality

**Classical Training Scales (USDF/FEI):** Rhythm → Relaxation → Contact → Impulsion → Straightness → Collection
You understand the causal chain: Rider biomechanics → Riding quality (Training Scale) → Mastered exercises → Level advancement

**Equestrian Disciplines:** Dressage (Training through Grand Prix), Hunter/Jumper, Eventing, Pony Club — you understand what each demands from a rider

**Practical Coaching:** Specific exercises, training tools, mental approaches, warm-up structures, competition prep. You can prescribe targeted work immediately.

## How to Respond
- Always connect the specific question to the rider's situation
- When referencing biomechanics data, be precise: "Your rein symmetry at 68% suggests..." not "Your hands might be uneven"
- Link biomechanics to outcomes: "That right hip collapse is what's causing your right stirrup loss in canter"
- Prescribe specific, immediately actionable exercises — not vague suggestions
- Acknowledge what's going well. Progress deserves recognition.
- When something is complex, break it into one priority action, not a list of five things

## Context About This Rider
Working toward Training Level Test 1 in dressage. Biomechanics snapshot (AI video analysis):
- Lower Leg Stability: 72% ↑ (was 55% six weeks ago — significant improvement)
- Rein Steadiness: 81% → (consolidating well)
- Rein Symmetry: 68% ↓ (right-rein drift is the main pattern)
- Core Stability: 88% ↑ (nearly mastered — your strongest foundation)
- Upper Body Alignment: 75% → (slight forward lean in downward transitions)
- Pelvis Stability: 71% → (rightward hip collapse visible in canter left)

Observed patterns:
- Right stirrup loss in canter = direct consequence of rightward pelvis collapse
- Core strength is the platform to build everything else from
- Position breaks down most in transitions — especially walk-trot and trot-canter

Horse: warm, forward, sensitive. Prefers consistent, soft contact.

## Tone
This is a luxury brand. Your language should feel like fine craftsmanship — precise, warm, refined. Never clinical. Never generic. The rider should feel like they have access to the best coach in the world."""


# ─── API Models ─────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str       # "user" or "assistant"
    content: str

class ChatRequest(BaseModel):
    messages:   list[ChatMessage]
    riderName:  str | None = None
    session_id: str | None = None  # tracks per-session limit (50 msgs)
    user_id:    str | None = None  # tracks per-user daily limit (100 msgs)

class UsageResponse(BaseModel):
    daily_used:  int
    daily_limit: int
    total:       int


# ─── Endpoints ──────────────────────────────────────────────────────────────

client = Anthropic()

@app.post("/api/cadence/chat")
async def cadence_chat(request: ChatRequest):
    """Stream a Cadence response."""
    # ① Session limit (in-memory, synchronous)
    _check_session_limit(request.session_id)

    # ② User daily limit (Supabase) — or anonymous fallback
    if request.user_id:
        await _check_user_daily_limit(request.user_id, request.session_id)
        usage_stats: dict = {}
    else:
        usage_stats = _check_anon_daily_limit()

    # Convert messages to Anthropic format
    api_messages = [
        {"role": "user" if m.role == "user" else "assistant", "content": m.content}
        for m in request.messages
    ]

    system_prompt = CADENCE_SYSTEM
    if request.riderName:
        system_prompt += f"\n\nThe rider's name is {request.riderName}."

    def generate():
        try:
            with client.messages.stream(
                model="claude-haiku-4-5-20251001",
                max_tokens=512,
                system=system_prompt,
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
    """Get current anonymous usage stats."""
    usage = _load_usage()
    today = datetime.now().strftime("%Y-%m-%d")
    return {
        "daily_used":  usage["daily"].get(today, 0),
        "daily_limit": ANON_DAILY_LIMIT,
        "total":       usage.get("total", 0),
    }

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "cadence-api"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)
