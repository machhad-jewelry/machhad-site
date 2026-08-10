// Supabase Edge Function: يولّد بيانات صنف كاملة من وصف نصي مختصر عبر Claude API — الاسم/الخامة/الوصف
// بثلاث لغات، والتصنيف واللون، وأيضًا أي تفاصيل بيع صريحة يذكرها المستخدم بالوصف (طريقة البيع، السعر،
// التكلفة، الوزن والمعدن، المندوب، بلدان التوفر) إذا ذكرها — وإلا تُترك فارغة ليعبّيها المستخدم يدويًا.
// المفتاح محمي هون فقط (متغير بيئة خادمي)، وما يوصل للمتصفح أبدًا.
// أمان: نتحقق إنه المتصل مشرف يملك صلاحية 'add' قبل استدعاء الذكاء الاصطناعي (يمنع استهلاك الحصة من متصل غير مخوّل)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const COUNTRIES = [
  { id: "abidjan", ar: "أبيدجان — ساحل العاج", en: "Abidjan — Côte d'Ivoire", fr: "Abidjan — Côte d'Ivoire" },
  { id: "congo", ar: "الكونغو", en: "Congo", fr: "Congo" },
  { id: "lebanon", ar: "لبنان", en: "Lebanon", fr: "Liban" },
];

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
    sale_method: { type: "string", enum: ["piece", "weight"] },
    price: { type: "number" },
    cost: { type: "number" },
    stock: { type: "integer" },
    weight_grams: { type: "number" },
    metal_type: { type: "string", enum: ["gold", "silver", "none"] },
    gold_karat: { type: "integer", enum: [18, 21, 22, 0] },
    silver_type: { type: "string", enum: ["male", "female", "none"] },
    rep: { type: "string" },
    countries: { type: "array", items: { type: "string" } },
  },
  required: [
    "name_ar", "name_en", "name_fr",
    "mat_ar", "mat_en", "mat_fr",
    "desc_ar", "desc_en", "desc_fr",
    "category_id", "color_hex",
    "sale_method", "price", "cost", "stock", "weight_grams",
    "metal_type", "gold_karat", "silver_type", "rep", "countries",
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

    const { description, categories, reps } = await req.json();
    if (!description || typeof description !== "string" || !description.trim()) {
      throw new Error("description is required");
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    const categoryList = (categories ?? [])
      .map((c: any) => `- ${c.id}: ${c.name?.ar ?? ""} / ${c.name?.en ?? ""} / ${c.name?.fr ?? ""}`)
      .join("\n");
    const repList = (reps ?? []).length ? (reps as string[]).join(", ") : "(no reps provided)";
    const countryList = COUNTRIES.map((c) => `- ${c.id}: ${c.ar} / ${c.en} / ${c.fr}`).join("\n");

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
        "الأسماء يجب تكون قصيرة وجذابة (أقل من ٦ كلمات)، والوصف من جملتين إلى ثلاث جمل يبرز الخامة والحرفية اليدوية.\n\n" +
        "بالإضافة لهيك، إذا ذكر الوصف أي من التفاصيل التالية صراحة، استخرجها للحقول المخصصة (وإلا اتركها بالقيمة الافتراضية المذكورة، لا تخترع قيمة):\n" +
        "- sale_method: 'weight' فقط إذا قال صراحة إنه يُباع بالوزن/بالغرام، وإلا 'piece' (الافتراضي).\n" +
        "- price: سعر البيع بالدولار إذا ذُكر، وإلا 0.\n" +
        "- cost: سعر التكلفة بالدولار إذا ذُكر، وإلا 0.\n" +
        "- stock: الكمية المتوفرة (عدد القطع) إذا ذُكرت، وإلا 0.\n" +
        "- weight_grams: الوزن بالغرام إذا ذُكر (فقط عندما sale_method='weight')، وإلا 0.\n" +
        "- metal_type: 'gold' أو 'silver' فقط إذا ذُكر المعدن صراحة مرتبطًا بالبيع بالوزن، وإلا 'none'.\n" +
        "- gold_karat: 18 أو 21 أو 22 إذا ذُكر عيار الذهب، وإلا 0.\n" +
        "- silver_type: 'male' (رجالي) أو 'female' (نسائي) إذا ذُكر نوع الفضة، وإلا 'none'.\n" +
        "- rep: اسم المندوب بالضبط كما هو مكتوب بالقائمة التالية إذا ذُكر اسمه بالوصف، وإلا نص فارغ \"\". قائمة المندوبين المتاحين: " +
        repList +
        ".\n" +
        "- countries: قائمة بمعرّفات (id) بلدان التوفر المذكورة صراحة بالوصف فقط، من القائمة التالية، وإلا مصفوفة فارغة []:\n" +
        countryList,
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
