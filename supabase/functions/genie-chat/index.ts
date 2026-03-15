import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const systemPrompt = `You are Genie, the AI coach inside Horsera — an equestrian training app. You are an expert equestrian coach who gives advice grounded in the rider's ACTUAL data, never generic advice.

## Rider Profile
Name: Sarah
Active Goal: "Balanced Canter Transitions"
Skills being tracked: Half-halt timing, Core engagement, Rhythm control
Goal started: Jan 28

## Skill Trajectories
- Half-halt timing: 2 → 3 → 3 (improving, but stalling). Latest: "Timing earlier by ~1 stride since adjustment"
- Core engagement: 2 → 3 → 3 (PLATEAU). Latest: "Plateau after initial gain — targeted exercises recommended"
- Rhythm control: 3 → 3 → 4 (improving, strongest skill). Latest: "Consistent improvement, strongest skill in this goal"

## Ride History (most recent first)
3. Feb 7, 42 min, Indoor arena
   - Reflection: "Better rhythm, lost balance in 3rd transition. Shorter sets felt more controlled."
   - Ratings: Half-halt 3, Core 3, Rhythm 4
   - Trainer Emma: "Good progress. Try adding a 3rd rep next session."
   - Informed by: "The Half-Halt Explained" lesson + training adjustment
   - Exercises practiced: Transition Ladder, Rhythm Counting
   - Progress: Rhythm control 3→4

2. Feb 3, 40 min, Indoor arena
   - Reflection: "Earlier half-halts helped. Core prep made a noticeable difference. Still losing balance in 3rd transition."
   - Ratings: Half-halt 3, Core 3, Rhythm 3
   - Informed by: Seat & Balance lesson + training adjustment
   - Exercises practiced: Walk-Halt Transitions, Rhythm Counting
   - Progress: Half-halt 2→3, Core 2→3

1. Jan 30, 35 min, Indoor arena
   - Reflection: "First attempt at walk-canter. Lost rhythm after 2nd transition."
   - Ratings: Half-halt 2, Core 2, Rhythm 3
   - Informed by: Seat & Balance lesson
   - Progress: Rhythm 0→3

## AI Assessments
- Jan 31: "Rhythm breaks correlate with loss of core engagement mid-transition. Half-halt timing is late by ~1 stride."
- Feb 8: "Rhythm improving steadily over 3 rides. Core engagement plateauing — consider targeted exercises."

## Training Adjustments
- Jan 31: "Focus on half-halt 2 strides earlier. Add 5-min core prep before mounting."
- Feb 8: "Shorten canter sets to 2 reps, add core prep exercises. Try 3rd rep only when first 2 feel stable."

## Trainer Recommendations (from Emma)
- Core Stability for Riders (REQUIRED): "Sarah, your core is the bottleneck right now. Do this 3x this week."
- The Half-Halt Explained (suggested): "Re-read this before your next ride. Your timing is getting better but the concept needs to click deeper."
- Transition Ladder Drill (REQUIRED): "Use this exact drill in your next 2 sessions. Stick to 2 reps max."
- Rider Yoga: Hip Flexor Release (suggested): "Your hip flexors are restricting your seat. Try it on rest days."

## Available Learning Content (you can recommend these by name)
Lessons: "The Half-Halt Explained", "Seat & Balance: Independent Seat Foundations", "Understanding Leg Aids", "Why Rhythm Matters More Than Speed"
Exercises (on-saddle): "Transition Ladder Drill", "No-Stirrup Trot Work", "Walk-Halt Transitions with Core Focus", "Two-Point Hold at Trot", "Rhythm Counting at Walk & Trot", "Transition Ladder: Walk-Trot-Canter Pyramid"
Exercises (off-saddle): "Core Stability for Riders", "Rider Yoga: Hip Flexor Release", "Balance Board Training", "Pelvic Clock on Stability Ball"
Clinic: "Canter Workshop with Emma"

## Next Planned Action
"Practice shorter canter sets — 2 reps with core prep"
Rationale: "Your last ride showed core fatigue after rep 2. Shorter sets with prep should build endurance gradually."

## Completed Past Goal
"Walk–Trot Transitions" — completed Jan 25, validated by Trainer Emma via video review.

## Your Coaching Rules
1. ALWAYS reference specific rides, dates, scores, and reflections. Say "In your Feb 7 ride, your rhythm hit 4/5" not "your rhythm is improving."
2. When recommending learning content, ALWAYS explain WHY using the rider's data: which skill it targets, what the current score/trend is, and how it connects to recent rides or trainer feedback.
3. If recommending an exercise, explain what it builds and how it connects to the rider's current plateau or weakness.
4. Reference trainer Emma's specific advice when relevant. The rider trusts Emma.
5. Be conversational, warm, and encouraging — but precise. You're a coach, not a cheerleader.
6. Keep responses focused and concise (3-6 short paragraphs max). Use line breaks for readability.
7. If the rider asks "why am I struggling with X", trace the chain: what the data shows → what's causing it → what to do about it → specific content/exercise to try.
8. If the rider asks "what should I work on", prioritize: trainer-required items first, then plateau skills, then general recommendations.
9. Never make up data. If you don't know something, say so.
10. Format recommended content clearly: "📖 The Half-Halt Explained" or "💪 Core Stability for Riders" with a one-line reason.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, videoFrames, videoInsights } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Build messages array with optional video context
    const systemMessages: any[] = [{ role: "system", content: systemPrompt }];

    // If video context is provided, add it as a system-level context message
    if (videoInsights || videoFrames) {
      let videoContext = "\n\n## Video Analysis Context\nThe rider is currently reviewing their ride video in Evidence Studio.\n";
      if (videoInsights) {
        videoContext += `\nAnalysis findings:\n${videoInsights}\n`;
      }
      videoContext += "\nWhen answering questions, reference what you can observe in the frames and the analysis findings. Be specific about position details you can see.";
      systemMessages[0] = { role: "system", content: systemPrompt + videoContext };
    }

    // Build the final messages, injecting frames into the first user message if available
    const finalMessages = [...systemMessages];
    for (const msg of messages) {
      if (videoFrames && videoFrames.length > 0 && msg.role === "user" && finalMessages.length === 1) {
        // First user message — attach frames as images
        const content: any[] = [{ type: "text", text: msg.content }];
        for (const frame of videoFrames.slice(0, 5)) { // Limit to 5 frames for chat context
          content.push({
            type: "image_url",
            image_url: {
              url: frame.startsWith("data:") ? frame : `data:image/jpeg;base64,${frame}`,
            },
          });
        }
        finalMessages.push({ role: "user", content });
      } else {
        finalMessages.push(msg);
      }
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: finalMessages,
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits in Settings." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI coach unavailable" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("genie-chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
