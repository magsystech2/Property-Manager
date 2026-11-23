// Supabase Edge Function: turns a spoken sentence (transcribed on the phone) into
// suggested expense fields. Optional: the app falls back to on-device parsing if this
// function isn't deployed.
//
// Deploy:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//          supabase functions deploy parse-expense
import Anthropic from "npm:@anthropic-ai/sdk@1.12.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["vendor", "date", "total", "tax", "description", "project", "category", "payer", "payment_method", "invoice_number"],
  properties: {
    vendor: { type: ["string", "null"] },
    date: { type: ["string", "null"], description: "YYYY-MM-DD" },
    total: { type: ["number", "null"], description: "Total in dollars" },
    tax: { type: ["number", "null"] },
    description: { type: ["string", "null"], description: "Under 80 characters" },
    project: { type: ["string", "null"], description: "Exactly one of the given project names, or null" },
    category: { type: ["string", "null"], description: "Exactly one of the given category names, or null" },
    payer: { type: ["string", "null"], enum: ["me", "llc", null], description: "me = the speaker paid personally; llc = LLC account" },
    payment_method: { type: ["string", "null"], enum: ["card", "check", "cash", "ach", "zelle", "wire", "other", null] },
    invoice_number: { type: ["string", "null"] },
  },
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // Only signed-in members of a workspace may use this.
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: membership } = await supabase.from("workspace_members").select("workspace_id").limit(1);
  if (!membership?.length) return Response.json({ error: "Not a workspace member" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const transcript = String(body.transcript ?? "").trim().slice(0, 2000);
  const projects: string[] = Array.isArray(body.projects) ? body.projects.map(String).slice(0, 100) : [];
  const categories: string[] = Array.isArray(body.categories) ? body.categories.map(String).slice(0, 100) : [];
  const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today ?? "") ? body.today : new Date().toISOString().slice(0, 10);
  if (!transcript) return Response.json({ error: "Nothing to read" }, { status: 400 });

  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: [
      "A partner in a house-flipping LLC is logging an expense by voice. Fill in the fields from what they said.",
      "Use null for anything not said. Never invent an amount.",
      `Today is ${today}; resolve relative dates against it.`,
      `Projects: ${projects.join("; ") || "(none)"}. Pick the one they mean (partial names count) or null.`,
      `Categories: ${categories.join("; ")}. Pick the best fit or null.`,
      "payer is 'me' when they paid personally (my card, I paid), 'llc' for the company/LLC/business account.",
    ].join("\n"),
    messages: [{ role: "user", content: `Transcript (speech-to-text, may contain errors): "${transcript}"` }],
  });

  if (response.stop_reason === "refusal") return Response.json({ error: "Couldn't read that" }, { status: 422 });
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return Response.json({ error: "No result" }, { status: 502 });
  const parsed = JSON.parse(text.text);
  if (parsed.project && !projects.includes(parsed.project)) parsed.project = null;
  if (parsed.category && !categories.includes(parsed.category)) parsed.category = null;
  return Response.json(parsed);
});
