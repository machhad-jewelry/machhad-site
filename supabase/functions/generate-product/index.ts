// Supabase Edge Function: يولّد بيانات صنف (اسم/خامة/وصف بثلاث لغات + تصنيف مقترح + لون) من وصف نصي مختصر
// عبر Claude API — المفتاح محمي هون فقط (متغير بيئة خادمي)، وما يوصل للمتصفح أبدًا.
// أمان: نتحقق إنه المتصل مشرف يملك صلاحية 'add' قبل استدعاء الذكاء الاصطناعي (يمنع استهلاك الحصة من متصل غير مخوّل)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    name_ar: { type: "string" },
    name_en: { type: "string" },
    name_fr: { type: "string" },
    mat_ar: { type: "string" },
    mat_en: { type: "string" },
    mat_fr: { type: "string" },
    desc_ar: { type: "string" },
    desc_en: { type: "string" },
    desc_fr: { type: "string" },
    category_id: { type: "string" },
    color_hex: { type: "string" },
  },
  required: [
    "name_ar", "name_en", "name_fr",
    "mat_ar", "mat_en", "mat_fr",
    "desc_ar", "desc_en", "desc_fr",
    "category_id", "color_hex",
  ],
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

    const { data: hasPerm, error: permErr } = await supabaseAuth.rpc("has_permission", { perm: "add" });
    if (permErr || !hasPerm) {
      throw new Error("Forbidden — missing 'add' permission");
    }

    const { description, categories } = await req.json();
    if (!description || typeof description !== "string" || !description.trim()) {
      throw new Error("description is required");
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    const categoryList = (categories ?? [])
      .map((c: any) => `- ${c.id}: ${c.name?.ar ?? ""} / ${c.name?.en ?? ""} / ${c.name?.fr ?? ""}`)
      .join("\n");

    const response = await anthropic.messages.create({
      model: "claude-opus-5",
      max_tokens: 2048,
      thinking: { type: "disabled" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: OUTPUT_SCHEMA },
      },
      system:
        "أنت مساعد لمتجر مجوهرات اسمه \"مشهد\" (Machhad) متخصص بالمجوهرات الفضية والعقيق اليماني المصنوعة يدويًا. " +
        "مهمتك تحويل وصف مختصر أو غير منظم يكتبه أو يمليه صوتيًا صاحب المتجر (وممكن يكون بالعربي أو الإنجليزي أو الفرنسي، وممكن يكون مقتضبًا جدًا) " +
        "إلى بيانات صنف كاملة ومصقولة بثلاث لغات (عربي، إنجليزي، فرنسي).\n\n" +
        "اختر أقرب تصنيف من القائمة التالية بالمعرف (id) بالضبط كما هو مكتوب:\n" +
        categoryList +
        "\n\nاقترح لونًا (hex) يمثل لون الحجر أو الخامة الأساسية بالمنتج (مثلًا عقيق أحمر → لون قرميدي دافئ، فضة → رمادي فاتح، ذهب → ذهبي).\n" +
        "الأسماء يجب تكون قصيرة وجذابة (أقل من ٦ كلمات)، والوصف من جملتين إلى ثلاث جمل يبرز الخامة والحرفية اليدوية.",
      messages: [{ role: "user", content: description }],
    });

    if (response.stop_reason === "refusal") {
      throw new Error("Generation was declined — try rephrasing the description");
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
