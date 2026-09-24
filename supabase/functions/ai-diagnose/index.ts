// Edge Function: ai-diagnose
// Optional enhancement for the AI Diagnostic dialog: turns the computed
// diagnostic facts into an LLM-written narrative. The deterministic report
// works without this function; deploying it just adds the "AI Narrative"
// section.
//
// Setup when you pick an LLM provider:
//   1. supabase functions deploy ai-diagnose
//   2. supabase secrets set LLM_BASE_URL=https://api.openai.com/v1 LLM_API_KEY=sk-... LLM_MODEL=gpt-4o-mini
//      (LLM_BASE_URL works with any OpenAI-compatible endpoint, e.g. Z.AI,
//       OpenAI, Together, or a local LLM server)
//   3. Restart the diagnosis dialog — the narrative appears automatically.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const baseUrl = Deno.env.get("LLM_BASE_URL");
  const apiKey = Deno.env.get("LLM_API_KEY");
  const model = Deno.env.get("LLM_MODEL") ?? "gpt-4o-mini";

  if (!baseUrl || !apiKey) {
    return new Response(JSON.stringify({ skipped: "LLM not configured" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { facts, beltName } = (await req.json()) as { facts: string; beltName: string };

    const llmResponse = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are a maintenance engineer writing a concise diagnostic narrative for a conveyor belt " +
              "monitoring system. Using ONLY the facts provided, write 3-5 sentences: interpret the " +
              "situation, state the most likely root cause, and give a clear recommended next step. " +
              "Do not invent data that is not in the facts.",
          },
          {
            role: "user",
            content: `Belt: ${beltName}\n\nFacts gathered by the diagnostic agent:\n${facts}`,
          },
        ],
        max_tokens: 300,
        temperature: 0.3,
      }),
    });

    if (!llmResponse.ok) {
      const detail = await llmResponse.text();
      return new Response(JSON.stringify({ error: detail }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = await llmResponse.json();
    const narrative = payload?.choices?.[0]?.message?.content ?? "";

    return new Response(JSON.stringify({ narrative }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
