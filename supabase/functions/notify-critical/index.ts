// Edge Function: notify-critical
// Sends an email via Resend when a critical alert is inserted.
//
// Setup (optional — the app works without it):
//   1. supabase functions deploy notify-critical
//   2. supabase secrets set RESEND_API_KEY=re_xxx ALERT_FROM_EMAIL=alerts@yourdomain.com ALERT_TO_EMAIL=you@example.com
//   3. Create a Database Webhook on the alerts table (INSERT event) pointing at
//      https://<project-ref>.supabase.co/functions/v1/notify-critical
// If RESEND_API_KEY is not configured, the function exits without error.

interface WebhookPayload {
  type: string;
  table: string;
  record: {
    id: string;
    belt_id: string;
    priority: string;
    title: string;
    description: string;
    created_at: string;
  };
}

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

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("ALERT_FROM_EMAIL");
  const toEmail = Deno.env.get("ALERT_TO_EMAIL");

  if (!resendApiKey || !fromEmail || !toEmail) {
    return new Response(JSON.stringify({ skipped: "email not configured" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const payload = (await req.json()) as WebhookPayload;
    const record = payload.record;
    if (payload.type !== "INSERT" || record?.priority !== "critical") {
      return new Response(JSON.stringify({ skipped: "not a critical alert insert" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        subject: `[CRITICAL] ${record.title}`,
        text:
          `Critical alert raised at ${record.created_at}\n\n` +
          `${record.title}\n\n${record.description}\n\n` +
          `Open the ConveyorWatch dashboard to acknowledge and resolve: ${Deno.env.get("SITE_URL") ?? ""}`,
      }),
    });

    if (!resendResponse.ok) {
      const detail = await resendResponse.text();
      return new Response(JSON.stringify({ error: detail }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ sent: true }), {
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
