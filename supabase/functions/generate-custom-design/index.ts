// Supabase Edge Function: تولّد معاينة بصرية لتصميم مجوهرات مخصّص (حرف أو اسم) عبر Google Gemini،
// وتسجّل صنف جديد "مخفي" (hidden) بجدول المنتجات بنفس نظام "البيع بالوزن" الحالي — بهيك السعر
// النهائي بيُحسب دايمًا من نفس المسار الآمن (metal_gram_prices) عند إتمام الشراء عبر place_order،
// بدون ما نحتاج نضيف أي منطق تسعير جديد أو نلمس أمان الطلبات الحالي.
// ملاحظة أمان: هاي الوظيفة مخصّصة للزوار (anon) على الموقع العام، مافي صلاحية إدارية تتحقق منها هون —
// عندها حدود معقولة (طول النص، حد أقصى للوزن) بس تمنع إساءة استخدام واضحة، مش صلاحيات مستخدم.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const COUNTRIES = ["abidjan", "congo", "lebanon"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { text, metalType, goldKarat, silverType, weightGrams } = await req.json();

    if (!text || typeof text !== "string" || !text.trim() || text.trim().length > 40) {
      throw new Error("text is required and must be 40 characters or fewer");
    }
    if (metalType !== "gold" && metalType !== "silver") {
      throw new Error("metalType must be 'gold' or 'silver'");
    }
    if (metalType === "gold" && ![18, 21, 22].includes(Number(goldKarat))) {
      throw new Error("goldKarat must be 18, 21, or 22");
    }
    if (metalType === "silver" && silverType !== "male" && silverType !== "female") {
      throw new Error("silverType must be 'male' or 'female'");
    }
    const weight = Number(weightGrams);
    if (!weight || weight <= 0 || weight > 500) {
      throw new Error("weightGrams must be a positive number up to 500");
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

    const cleanText = text.trim();
    const metalDesc = metalType === "gold" ? `${goldKarat}-karat gold` : "sterling silver";
    const prompt =
      `Professional studio product photograph of a single elegant handmade ${metalDesc} jewelry pendant/nameplate ` +
      `piece featuring the text "${cleanText}" beautifully shaped or engraved into the metal. Clean plain light-gray ` +
      `background, soft even lighting, high detail, realistic jewelry photography, centered composition. ` +
      `The text must be rendered exactly as given, clearly legible, and accurately spelled — do not alter, ` +
      `translate, or omit any character of it.`;

    const geminiResp = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent",
      {
        method: "POST",
        headers: { "x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
      }
    );
    if (!geminiResp.ok) {
      const errBody = await geminiResp.text();
      throw new Error(`Gemini API error ${geminiResp.status}: ${errBody}`);
    }
    const geminiData = await geminiResp.json();
    const parts = geminiData?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p: any) => p.inlineData?.data);
    if (!imagePart) throw new Error("No image returned from Gemini");
    const mimeType = imagePart.inlineData.mimeType || "image/png";
    const dataUri = `data:${mimeType};base64,${imagePart.inlineData.data}`;

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const id = "custom-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    const matAr = metalType === "gold" ? `ذهب عيار ${goldKarat}` : "فضة";
    const matEn = metalType === "gold" ? `${goldKarat}k Gold` : "Silver";
    const matFr = metalType === "gold" ? `Or ${goldKarat}k` : "Argent";

    const row = {
      id,
      cat: "custom",
      color: metalType === "gold" ? "#C9A24B" : "#B7BCC2",
      name_ar: `تصميم خاص: ${cleanText}`,
      name_en: `Custom Design: ${cleanText}`,
      name_fr: `Création Personnalisée: ${cleanText}`,
      mat_ar: matAr,
      mat_en: matEn,
      mat_fr: matFr,
      desc_ar: `تصميم خاص حسب الطلب — ${cleanText}`,
      desc_en: `Custom made-to-order design — ${cleanText}`,
      desc_fr: `Création personnalisée sur commande — ${cleanText}`,
      price: 0,
      cost: 0,
      stock: 1,
      sizes: [],
      images: [dataUri],
      countries: COUNTRIES,
      barcode: null,
      hidden: true,
      sale_method: "weight",
      weight_grams: weight,
      metal_type: metalType,
      gold_karat: metalType === "gold" ? Number(goldKarat) : null,
      silver_type: metalType === "silver" ? silverType : null,
    };

    const { error: insertErr } = await supabaseAdmin.from("products").insert(row);
    if (insertErr) throw new Error(insertErr.message);

    return new Response(JSON.stringify({ product: row }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
