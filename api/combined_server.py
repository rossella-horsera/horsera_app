"""
Combined server: serves the static Horsera frontend + Cadence API.
This allows both to run from a single URL for testing.
"""

import json
import time
import os
from datetime import datetime
from pathlib import Path

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

# ─── Usage Tracking ──────────────────────────────────────────────────────────

USAGE_FILE = Path("/tmp/cadence_usage.json")
DAILY_LIMIT = 50
MONTHLY_LIMIT = 500

def load_usage() -> dict:
    if USAGE_FILE.exists():
        return json.loads(USAGE_FILE.read_text())
    return {"daily": {}, "monthly": {}, "total": 0}

def save_usage(usage: dict):
    USAGE_FILE.write_text(json.dumps(usage))

def check_and_increment_usage() -> dict:
    usage = load_usage()
    today = datetime.now().strftime("%Y-%m-%d")
    month = datetime.now().strftime("%Y-%m")
    daily_count = usage["daily"].get(today, 0)
    monthly_count = usage["monthly"].get(month, 0)

    if daily_count >= DAILY_LIMIT:
        raise HTTPException(status_code=429, detail={
            "error": "daily_limit",
            "message": f"You've used all {DAILY_LIMIT} messages for today. Your limit resets at midnight.",
            "daily_used": daily_count, "daily_limit": DAILY_LIMIT,
        })
    if monthly_count >= MONTHLY_LIMIT:
        raise HTTPException(status_code=429, detail={
            "error": "monthly_limit",
            "message": f"You've reached your monthly limit of {MONTHLY_LIMIT} messages.",
            "monthly_used": monthly_count, "monthly_limit": MONTHLY_LIMIT,
        })

    usage["daily"][today] = daily_count + 1
    usage["monthly"][month] = monthly_count + 1
    usage["total"] = usage.get("total", 0) + 1
    save_usage(usage)
    return {
        "daily_used": daily_count + 1, "daily_limit": DAILY_LIMIT,
        "monthly_used": monthly_count + 1, "monthly_limit": MONTHLY_LIMIT,
        "total": usage["total"],
    }

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
    messages: list[ChatMessage]


# ─── Endpoints ───────────────────────────────────────────────────────────────

client = Anthropic()

@app.post("/api/cadence/chat")
async def cadence_chat(request: ChatRequest):
    usage_stats = check_and_increment_usage()
    api_messages = [{"role": "user" if m.role == "user" else "assistant", "content": m.content} for m in request.messages]

    def generate():
        try:
            with client.messages.stream(
                model="claude_haiku_4_5",
                max_tokens=512,
                system=CADENCE_SYSTEM,
                messages=api_messages,
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'type': 'text', 'text': text})}\n\n"
            yield f"data: {json.dumps({'type': 'usage', **usage_stats})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@app.get("/api/cadence/usage")
async def get_usage():
    usage = load_usage()
    today = datetime.now().strftime("%Y-%m-%d")
    month = datetime.now().strftime("%Y-%m")
    return {
        "daily_used": usage["daily"].get(today, 0), "daily_limit": DAILY_LIMIT,
        "monthly_used": usage["monthly"].get(month, 0), "monthly_limit": MONTHLY_LIMIT,
        "total": usage.get("total", 0),
    }

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "horsera"}


# ─── Static files (must be last) ────────────────────────────────────────────

DIST_DIR = Path(__file__).parent.parent / "dist"
if DIST_DIR.exists():
    # Serve static assets
    app.mount("/assets", StaticFiles(directory=str(DIST_DIR / "assets")), name="assets")
    
    # Serve all other static files from dist
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = DIST_DIR / full_path
        if file_path.is_file():
            return FileResponse(str(file_path))
        # SPA fallback — serve index.html for all routes
        return FileResponse(str(DIST_DIR / "index.html"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)
