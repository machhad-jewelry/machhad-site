// Supabase Edge Function: يرسل إيميل لصاحب المتجر مع فاتورة PDF مرفقة عند كل طلب جديد
// أمان: لا نثق بأي بيانات نصية يرسلها المتصفح (اسم الزبون، الهاتف، الإجمالي...) —
// نتحقق أولًا إن الطلب موجود فعليًا بقاعدة البيانات ونستخرج بياناته الحقيقية من هناك،
// حتى ما يقدر حدا يستدعي هاي الوظيفة مباشرة ويرسل إيميلات وهمية بمحتوى مفبرك.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { orderId, pdfBase64 } = await req.json();
    if (!orderId || !pdfBase64) {
      throw new Error("orderId and pdfBase64 are required");
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const OWNER_EMAIL = Deno.env.get("OWNER_EMAIL") ?? "rachad.fakouri@gmail.com";
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");

    // عميل بصلاحية الخادم الكاملة — يتجاوز RLS عمدًا حتى يقدر يقرأ الطلب،
    // بس هو الوحيد يلي بيقدر يستخدمه (مفتاح داخلي بالوظيفة، ما يوصل للمتصفح أبدًا)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: order, error: orderErr } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single();
    if (orderErr || !order) {
      throw new Error("Order not found — refusing to send email for an unverified order");
    }

    // رفض إعادة إرسال إيميل لطلب قديم جدًا (يمنع إعادة استدعاء الوظيفة بنفس رقم طلب حقيقي بشكل متكرر)
    const ageMs = Date.now() - new Date(order.created_at).getTime();
    if (ageMs > 15 * 60 * 1000) {
      throw new Error("Order is too old — refusing to (re-)send invoice email");
    }

    const { data: items } = await supabaseAdmin
      .from("order_items")
      .select("*")
      .eq("order_id", orderId);

    const total = (items ?? []).reduce((s: number, it: any) => s + Number(it.price) * it.qty, 0);

    const html = `
      <div dir="rtl" style="font-family: sans-serif;">
        <h2>طلب جديد — مشهد</h2>
        <p>رقم الطلب: ${order.id}</p>
        <p>الزبون: ${order.customer_name ?? ""} — ${order.customer_phone ?? ""}</p>
        <p>البلد: ${order.country}</p>
        <p>طريقة الدفع: ${order.payment ?? ""}</p>
        <p>الإجمالي: ${total.toFixed(2)} USD</p>
        <p>الفاتورة الكاملة مرفقة بصيغة PDF.</p>
      </div>
    `;

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Machhad Store <onboarding@resend.dev>",
        to: [OWNER_EMAIL],
        subject: `طلب جديد #${order.id} — مشهد`,
        html,
        attachments: [{ filename: `invoice-${order.id}.pdf`, content: pdfBase64 }],
      }),
    });

    const data = await emailRes.json();
    if (!emailRes.ok) {
      throw new Error(JSON.stringify(data));
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
