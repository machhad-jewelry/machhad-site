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
    const isArabic = (s: unknown) => typeof s === "string" && /[؀-ۿ]/.test(s);
    const system =
      "You translate a short jewelry-store category name from Arabic into English and French — including " +
      "colloquial/dialect words, plurals, and jewelry-specific terms that may not have one obvious equivalent " +
      "(rings, necklaces, bracelets, earrings, anklets, pins/brooches, prayer beads, cufflinks, pendants, charms, " +
      "chains, etc.). Always produce your best short English/French equivalent, even for an unfamiliar or unusual " +
      "word — never leave the field untranslated. " +
      "name_en MUST be written in English script only, and name_fr MUST be written in French script only — " +
      "never copy or leave any part of the Arabic input in either field.";

    // نعطي المحاولة حتى 3 مرات — النموذج أحيانًا (خصوصًا مع كلمات غير مألوفة) بيرجّع النص العربي نفسه
    // بدل ما يترجمه رغم التعليمات، فبنعيد المحاولة بتوضيح أقوى بدل ما نفشل من أول مرة
    let lastResult: { name_en?: string; name_fr?: string } | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const userMsg =
        attempt === 0
          ? text.trim()
          : `Translate this Arabic jewelry-category name to English and French: "${text.trim()}". ` +
            "Do not repeat the Arabic — give your best real English and French words for it.";

      const response = await anthropic.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 256,
        thinking: { type: "disabled" },
        output_config: {
          format: { type: "json_schema", schema: OUTPUT_SCHEMA },
        },
        system,
        messages: [{ role: "user", content: userMsg }],
      });

      if (response.stop_reason === "refusal") {
        throw new Error("Translation was declined");
      }

      const textBlock = response.content.find((b: any) => b.type === "text") as any;
      if (!textBlock) continue;

      const parsed = JSON.parse(textBlock.text);
      lastResult = parsed;

      if (!isArabic(parsed.name_en) && !isArabic(parsed.name_fr)) {
        return new Response(JSON.stringify(parsed), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // بعد 3 محاولات، ما زال في عربي بالنتيجة — منرجّع أفضل نتيجة وصلنا لها بدل فشل كامل
    if (lastResult) {
      return new Response(JSON.stringify(lastResult), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    throw new Error("No structured output returned");
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
