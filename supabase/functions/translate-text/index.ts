// Supabase Edge Function: يترجم اسم قصير (مثل اسم تصنيف) من العربية إلى الإنجليزية والفرنسية عبر Claude API —
// المفتاح محمي هون فقط (متغير بيئة خادمي)، وما يوصل للمتصفح أبدًا.
// أمان: نتحقق إنه المتصل مشرف يملك صلاحية 'categories' قبل استدعاء الذكاء الاصطناعي (يمنع استهلاك الحصة من متصل غير مخوّل)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    name_en: { type: "string" },
    name_fr: { type: "string" },
  },
  required: ["name_en", "name_fr"],
  additionalProperties: false,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: hasPerm, error: permErr } = await supabaseAuth.rpc("has_permission", { perm: "categories" });
    if (permErr || !hasPerm) {
      throw new Error("Forbidden — missing 'categories' permission");
    }

    const { text } = await req.json();
    if (!text || typeof text !== "string" || !text.trim()) {
      throw new Error("text is required");
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      thinking: { type: "disabled" },
      output_config: {
        format: { type: "json_schema", schema: OUTPUT_SCHEMA },
      },
      system:
        "أنت مترجم لأسماء تصنيفات متجر مجوهرات اسمه \"مشهد\" (Machhad). تترجم اسم تصنيف قصير من العربية " +
        "إلى الإنجليزية والفرنسية بدقة، بصيغة قصيرة ومناسبة لاسم قسم بمتجر إلكتروني (مثلًا: خواتم → " +
        "Rings / Bagues، أساور → Bracelets / Bracelets).",
      messages: [{ role: "user", content: text.trim() }],
    });

    if (response.stop_reason === "refusal") {
      throw new Error("Translation was declined");
    }

    const textBlock = response.content.find((b: any) => b.type === "text") as any;
    if (!textBlock) throw new Error("No structured output returned");

    const parsed = JSON.parse(textBlock.text);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
