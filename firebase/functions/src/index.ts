/**
 * Cloud Functions for Flip Tracker.
 *
 *  - parseReceipt: reads a receipt/bill photo and returns pre-filled expense fields.
 *  - parseVoice:   turns a spoken sentence (already transcribed on the phone) into expense fields.
 *
 * The Anthropic API key lives only here, as a Firebase secret:
 *   firebase functions:secrets:set ANTHROPIC_API_KEY
 * Only signed-in partners listed in Firestore config/partners can call these.
 */
import Anthropic from "@anthropic-ai/sdk";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { defineSecret } from "firebase-functions/params";
import { CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";

initializeApp();
const anthropicKey = defineSecret("ANTHROPIC_API_KEY");
const MODEL = "claude-opus-5-5";

export const CATEGORIES = [
  "Purchase / Closing", "Materials", "Labor", "Contractor", "Permits & Fees",
  "Utilities", "Insurance", "Property Tax", "Loan Interest", "Equipment Rental",
  "Dumpster / Debris", "Inspection / Appraisal", "Staging / Cleaning",
  "Selling Costs", "Other",
] as const;
const PAYMENT_METHODS = ["Card", "Check", "Zelle", "ACH / Wire", "Cash", "Other"] as const;

/** Shape returned to the app. Any field the model can't determine is null. */
const EXPENSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "vendor", "date", "amount", "category", "description",
    "invoiceNumber", "propertyName", "paymentMethod", "paidFromLLC", "status",
  ],
  properties: {
    vendor: { type: ["string", "null"], description: "Store, company or person paid" },
    date: { type: ["string", "null"], description: "Date in YYYY-MM-DD" },
    amount: { type: ["number", "null"], description: "Total amount actually charged, in dollars" },
    category: { type: ["string", "null"], enum: [...CATEGORIES, null] },
    description: { type: ["string", "null"], description: "Short summary of what was bought or done, under 80 characters" },
    invoiceNumber: { type: ["string", "null"] },
    propertyName: { type: ["string", "null"], description: "Must be one of the known property names, or null" },
    paymentMethod: { type: ["string", "null"], enum: [...PAYMENT_METHODS, null] },
    paidFromLLC: { type: ["boolean", "null"], description: "true if paid from the LLC/business account, false if the partner paid personally, null if unclear" },
    status: { type: ["string", "null"], enum: ["Paid", "Unpaid", null], description: "Unpaid if this is a bill/invoice not yet paid" },
  },
} as const;

type ParsedExpense = {
  vendor: string | null;
  date: string | null;
  amount: number | null;
  category: string | null;
  description: string | null;
  invoiceNumber: string | null;
  propertyName: string | null;
  paymentMethod: string | null;
  paidFromLLC: boolean | null;
  status: "Paid" | "Unpaid" | null;
};

async function requirePartner(req: CallableRequest): Promise<void> {
  const email = req.auth?.token.email?.toLowerCase();
  if (!email) throw new HttpsError("unauthenticated", "Sign in first.");
  const snap = await getFirestore().doc("config/partners").get();
  const emails: string[] = snap.get("emails") ?? [];
  if (!emails.includes(email)) throw new HttpsError("permission-denied", "Not a partner account.");
}

function systemPrompt(propertyNames: string[], today: string): string {
  return [
    "You help a 3-partner LLC that flips houses and builds new homes log their spending.",
    "Fill in the expense fields from what the user gives you. Use null for anything you cannot tell; never guess an amount.",
    `Today's date is ${today}. Resolve relative dates such as "yesterday" against it.`,
    `Known properties: ${propertyNames.length ? propertyNames.join("; ") : "(none yet)"}.`,
    "propertyName must be copied exactly from that list when the user clearly refers to one (partial or spoken names count, e.g. 'Oak' -> 'Oak St'); otherwise null.",
    "Category guide: lumber, tile, fixtures, paint and supplies are Materials; a hired company invoicing for a job is Contractor; hourly or day workers paid directly are Labor; city or county fees are Permits & Fees.",
    "For a receipt, amount is the final total including tax. For a contractor bill or invoice that is not marked paid, status is Unpaid.",
  ].join("\n");
}

async function extract(
  content: Anthropic.Beta.Messages.BetaContentBlockParam[],
  propertyNames: string[],
  today: string,
): Promise<ParsedExpense> {
  const client = new Anthropic({ apiKey: anthropicKey.value() });
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: EXPENSE_SCHEMA as unknown as Record<string, unknown> },
    },
    system: systemPrompt(propertyNames, today),
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    throw new HttpsError("failed-precondition", "Couldn't read that. Please enter it by hand.");
  }
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new HttpsError("internal", "No result from the reader.");
  const parsed = JSON.parse(text.text) as ParsedExpense;
  // Only keep a property name that actually exists.
  if (parsed.propertyName && !propertyNames.includes(parsed.propertyName)) parsed.propertyName = null;
  return parsed;
}

function cleanInput(req: CallableRequest) {
  const data = (req.data ?? {}) as Record<string, unknown>;
  const propertyNames = Array.isArray(data.propertyNames)
    ? (data.propertyNames as unknown[]).filter((p): p is string => typeof p === "string").slice(0, 200)
    : [];
  const today = typeof data.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.today)
    ? data.today
    : new Date().toISOString().slice(0, 10);
  return { data, propertyNames, today };
}

/** Input: { storagePath: "receipts/<uid>/<file>.jpg", propertyNames: string[], today: "YYYY-MM-DD" } */
export const parseReceipt = onCall(
  { secrets: [anthropicKey], timeoutSeconds: 120, memory: "512MiB" },
  async (req) => {
    await requirePartner(req);
    const { data, propertyNames, today } = cleanInput(req);
    const path = data.storagePath;
    if (typeof path !== "string" || !path.startsWith("receipts/")) {
      throw new HttpsError("invalid-argument", "storagePath is required.");
    }
    const file = getStorage().bucket().file(path);
    const [meta] = await file.getMetadata();
    const mediaType = String(meta.contentType ?? "image/jpeg");
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mediaType)) {
      throw new HttpsError("invalid-argument", "Receipt must be a JPEG or PNG photo.");
    }
    const [bytes] = await file.download();
    return extract(
      [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
            data: bytes.toString("base64"),
          },
        },
        { type: "text", text: "This is a photo of a receipt, bill or contractor invoice. Fill in the expense." },
      ],
      propertyNames,
      today,
    );
  },
);

/** Input: { transcript: string, propertyNames: string[], today: "YYYY-MM-DD" } */
export const parseVoice = onCall(
  { secrets: [anthropicKey], timeoutSeconds: 60 },
  async (req) => {
    await requirePartner(req);
    const { data, propertyNames, today } = cleanInput(req);
    const transcript = typeof data.transcript === "string" ? data.transcript.trim().slice(0, 2000) : "";
    if (!transcript) throw new HttpsError("invalid-argument", "Nothing was heard. Try again.");
    return extract(
      [{ type: "text", text: `A partner said this to log an expense (speech-to-text, may contain errors):\n"${transcript}"` }],
      propertyNames,
      today,
    );
  },
);
