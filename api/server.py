"""
Cadence API — Horsera's intelligent riding advisor backend.
Provides LLM-powered chat with equestrian context, usage tracking, and rate limiting.
"""

import json
import time
import os
from datetime import datetime
from pathlib import Path

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

# ─── Usage Tracking ────────────────────────────────────────────

USAGE_FILE = Path("/tmp/cadence_usage.json")
DAILY_LIMIT = 50  # messages per day — generous for testing
MONTHLY_LIMIT = 500  # messages per month

def load_usage() -> dict:
    if USAGE_FILE.exists():
        return json.loads(USAGE_FILE.read_text())
    return {"daily": {}, "monthly": {}, "total": 0}

def save_usage(usage: dict):
    USAGE_FILE.write_text(json.dumps(usage))

def check_and_increment_usage() -> dict:
    """Check if user is within limits. Returns usage stats. Raises HTTPException if over limit."""
    usage = load_usage()
    today = datetime.now().strftime("%Y-%m-%d")
    month = datetime.now().strftime("%Y-%m")

    daily_count = usage["daily"].get(today, 0)
    monthly_count = usage["monthly"].get(month, 0)

    if daily_count >= DAILY_LIMIT:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "daily_limit",
                "message": f"You've used all {DAILY_LIMIT} messages for today. Your limit resets at midnight. Great job engaging with Cadence today!",
                "daily_used": daily_count,
                "daily_limit": DAILY_LIMIT,
            }
        )

    if monthly_count >= MONTHLY_LIMIT:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "monthly_limit",
                "message": f"You've reached your monthly limit of {MONTHLY_LIMIT} messages. This resets at the start of next month.",
                "monthly_used": monthly_count,
                "monthly_limit": MONTHLY_LIMIT,
            }
        )

    # Increment
    usage["daily"][today] = daily_count + 1
    usage["monthly"][month] = monthly_count + 1
    usage["total"] = usage.get("total", 0) + 1
    save_usage(usage)

    return {
        "daily_used": daily_count + 1,
        "daily_limit": DAILY_LIMIT,
        "monthly_used": monthly_count + 1,
        "monthly_limit": MONTHLY_LIMIT,
        "total": usage["total"],
    }


# ─── Cadence System Prompt ─────────────────────────────────────────

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


# ─── API Models ────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str

class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    riderName: str | None = None

class UsageResponse(BaseModel):
    daily_used: int
    daily_limit: int
    monthly_used: int
    monthly_limit: int
    total: int


# ─── Endpoints ────────────────────────────────────────────────

client = Anthropic()

@app.post("/api/cadence/chat")
async def cadence_chat(request: ChatRequest):
    """Stream a Cadence response."""
    # Check usage limits
    usage_stats = check_and_increment_usage()

    # Convert messages to Anthropic format
    api_messages = []
    for msg in request.messages:
        role = "user" if msg.role == "user" else "assistant"
        api_messages.append({"role": role, "content": msg.content})

    # Build system prompt, optionally with rider name
    system_prompt = CADENCE_SYSTEM
    if request.riderName:
        system_prompt += f"\n\nThe rider's name is {request.riderName}."

    # Stream the response
    def generate():
        try:
            with client.messages.stream(
                model="claude_haiku_4_5",
                max_tokens=512,
                system=system_prompt,
                messages=api_messages,
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'type': 'text', 'text': text})}\n\n"

            # Send usage stats at the end
            yield f"data: {json.dumps({'type': 'usage', **usage_stats})}\n\n"
            yield "data: [DONE]\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )

@app.get("/api/cadence/usage")
async def get_usage():
    """Get current usage stats."""
    usage = load_usage()
    today = datetime.now().strftime("%Y-%m-%d")
    month = datetime.now().strftime("%Y-%m")

    return {
        "daily_used": usage["daily"].get(today, 0),
        "daily_limit": DAILY_LIMIT,
        "monthly_used": usage["monthly"].get(month, 0),
        "monthly_limit": MONTHLY_LIMIT,
        "total": usage.get("total", 0),
    }

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "cadence-api"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)