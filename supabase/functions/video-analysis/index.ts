import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const systemPrompt = `You are an expert equestrian trainer reviewing sampled video frames of a rider. You have decades of experience coaching dressage, jumping, and flatwork riders at all levels.

## Your Task — Two-Stage Analysis

### Stage 1: Goal-Agnostic Observation (ALWAYS do this first)
Analyze the provided frames WITHOUT reference to the rider's stated goal. Assess only what the video objectively shows.

Detect and report:
- **Gaits present** — Which gaits are visible (walk, trot, canter, halt, or mixed)? If a gait is NOT visible, do NOT generate observations about it.
- **Seat position and balance** — Weight distribution, centered position, following the horse's motion
- **Upper body alignment** — Shoulder alignment, lean, stiffness vs suppleness
- **Hand and leg stability** — Contact quality, lower leg position, heel depth
- **Core engagement** — Visible collapse, hollowing, bracing
- **Rhythm and consistency** — Rider staying with the horse, posting timing, stride regularity

This stage answers: "What is objectively happening in this video?"

### Stage 2: Goal Lens (ONLY if relevant)
After completing Stage 1, check whether the rider's stated goal is relevant to what was actually detected.
- If the goal involves a gait or skill NOT present in the video, do NOT invent feedback about it.
- Instead, note in the overallSummary which gaits/skills were absent.
- Only apply goal-specific commentary when there is meaningful overlap between the goal and what the frames show.

Example: If the goal is "Balanced Canter Transitions" but no canter is detected, include a note like:
"No canter was detected in this video. Insights below reflect overall position and balance observed in walk and trot."

## Analysis Categories
Evaluate across these categories (only include categories where you have ACTUAL observations from the frames):

1. **Seat & Balance** (seat_balance) — Weight distribution, centered position, following the horse's motion
2. **Upper Body** (upper_body) — Shoulder alignment, forward/backward lean, stiffness vs suppleness
3. **Head Position** (head_position) — Looking down, tilting, chin position, eye line
4. **Hand & Arm** (hand_arm) — Soft/elastic contact, straight line elbow-to-bit, hand height, fist position
5. **Leg Position** (leg_position) — Lower leg stability, heel depth, toe angle, leg at the girth vs behind
6. **Core Engagement** (core_engagement) — Visible collapse, hollowing the back, bracing vs following
7. **Aids Quality** (aids_quality) — Visible leg aids, rein aids, timing of aids relative to horse's stride
8. **Rhythm & Timing** (rhythm_timing) — Rider staying with the horse's rhythm, posting timing, transition smoothness

## Rules
- Use aggregate language: "across these frames", "in several samples", "appears to show"
- NEVER claim certainty. Frame as "suggests", "appears to", "may indicate"
- Rate severity: "low" (minor refinement), "medium" (noticeable impact), "high" (key focus area)
- Rate confidence: "low" (limited visibility/ambiguous) or "medium" (clear pattern across frames)
- Connect observations to specific riding skills
- For each insight, suggest ONE concrete exercise or resource
- Provide 1-3 "next ride" action items ranked by impact
- If frames are unclear or don't show enough detail, say so honestly
- NEVER fabricate observations about gaits or movements not visible in the frames
- Report which gaits were detected in the overallSummary`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { frames, riderContext, question } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    if (!frames || !Array.isArray(frames) || frames.length === 0) {
      return new Response(JSON.stringify({ error: "No frames provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build user message with images
    const userContent: any[] = [];

    // Add rider context — clearly separated as Stage 2 context
    const contextText = riderContext
      ? `Rider context (for Stage 2 only — do NOT let this bias Stage 1 observations):\n- Goal: ${riderContext.goal}\n- Skills: ${riderContext.skills?.join(", ")}\n- Recent notes: ${riderContext.recentNotes || "None"}\n\n`
      : "";

    const promptText = question
      ? `${contextText}The rider asks: "${question}"\n\nFirst complete Stage 1 (goal-agnostic analysis of what the frames show), then address the question. Only reference the goal if relevant to detected content.`
      : `${contextText}Analyze these ${frames.length} sampled frames from the rider's session.\n\nStep 1: Describe objectively what you see — which gaits, what position patterns, what the rider is doing.\nStep 2: Only if the rider's goal overlaps with detected content, add goal-relevant commentary.\n\nDo NOT invent observations about gaits or skills not visible in the frames.`;

    userContent.push({ type: "text", text: promptText });

    // Add frame images
    for (const frame of frames) {
      userContent.push({
        type: "image_url",
        image_url: {
          url: frame.startsWith("data:") ? frame : `data:image/jpeg;base64,${frame}`,
        },
      });
    }

    const tools = [
      {
        type: "function",
        function: {
          name: "report_analysis",
          description: "Report the structured riding analysis results",
          parameters: {
            type: "object",
            properties: {
              detectedGaits: {
                type: "array",
                items: { type: "string", enum: ["walk", "trot", "canter", "halt", "mixed"] },
                description: "Gaits actually observed in the frames",
              },
              goalRelevance: {
                type: "string",
                description: "Brief note on whether the rider's goal is relevant to the detected content. If not, explain what was missing.",
              },
              insights: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    category: {
                      type: "string",
                      enum: ["seat_balance", "upper_body", "head_position", "hand_arm", "leg_position", "core_engagement", "aids_quality", "rhythm_timing"],
                    },
                    observation: {
                      type: "string",
                      description: "Detailed observation using aggregate language (2-4 sentences). Must be based on what is actually visible.",
                    },
                    severity: { type: "string", enum: ["low", "medium", "high"] },
                    confidence: { type: "string", enum: ["low", "medium"] },
                    pattern: {
                      type: "string",
                      enum: ["consistent", "intermittent", "late-session", "early-session", "transitions-only"],
                    },
                    relatedSkills: {
                      type: "array",
                      items: { type: "string" },
                      description: "Riding skills this observation relates to",
                    },
                    recommendedExercise: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        description: { type: "string", description: "Brief description of the exercise and why it helps" },
                        onSaddle: { type: "boolean" },
                      },
                      required: ["title", "description", "onSaddle"],
                    },
                  },
                  required: ["category", "observation", "severity", "confidence", "pattern", "relatedSkills", "recommendedExercise"],
                  additionalProperties: false,
                },
              },
              nextRideActions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    text: { type: "string", description: "Concrete action for the next ride" },
                    linkedSkill: { type: "string" },
                    priority: { type: "string", enum: ["high", "medium", "low"] },
                  },
                  required: ["text", "linkedSkill", "priority"],
                  additionalProperties: false,
                },
                description: "1-3 next ride actions ranked by impact",
              },
              overallSummary: {
                type: "string",
                description: "2-3 sentence overall summary. Start with what gaits were detected. If the rider's goal involves content not present in the video, note that clearly.",
              },
            },
            required: ["detectedGaits", "goalRelevance", "insights", "nextRideActions", "overallSummary"],
            additionalProperties: false,
          },
        },
      },
    ];

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "report_analysis" } },
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
      return new Response(JSON.stringify({ error: "AI analysis unavailable" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    
    // Extract tool call result
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== "report_analysis") {
      console.error("No tool call in response:", JSON.stringify(data));
      return new Response(JSON.stringify({ error: "AI did not return structured analysis" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const analysisResult = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(analysisResult), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("video-analysis error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
