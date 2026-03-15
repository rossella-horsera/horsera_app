import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { query, catalog } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `You are a learning content search assistant for an equestrian training app called Horsera.

You receive a catalog of learning items (lessons, exercises, clinics, explanations) and a user query.

Your job is to return the IDs of items that best match the user's intent, ranked by relevance. Think semantically — understand what the rider actually needs, not just keyword matching.

Rules:
- Return ONLY a JSON array of item IDs, most relevant first. Example: ["l1", "l3", "l5"]
- Maximum 6 results
- If the query is conversational (e.g. "I keep losing balance in canter"), interpret it as a learning need
- If nothing matches well, return an empty array []
- Also return a brief one-sentence "insight" explaining why these results help

Return exactly this JSON format:
{"ids": ["l1", "l3"], "insight": "These focus on core stability which directly addresses balance loss during canter."}`;

    const catalogSummary = catalog.map((item: any) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      description: item.description,
      skillDomains: item.skillDomains,
      linkedGoals: item.linkedGoals,
      linkedSkills: item.linkedSkills,
      difficulty: item.difficulty,
    }));

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Catalog:\n${JSON.stringify(catalogSummary, null, 2)}\n\nUser query: "${query}"`,
          },
        ],
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
      return new Response(JSON.stringify({ error: "AI search unavailable" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";

    // Extract JSON from possible markdown fences
    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { ids: [], insight: "" };
    } catch {
      parsed = { ids: [], insight: "" };
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("learn-search error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
