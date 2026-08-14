// Supabase Edge Function: يرسل إيميل لصاحب المتجر مع فاتورة PDF مرفقة عند كل طلب جديد
// أمان: لا نثق بأي بيانات نصية يرسلها المتصفح (اسم الزبون، الهاتف، الإجمالي...) —
// نتحقق أولًا إن الطلب موجود فعليًا بقاعدة البيانات ونستخرج بياناته الحقيقية من هناك،
// حتى ما يقدر حدا يستدعي هاي الوظيفة مباشرة ويرسل إيميلات وهمية بمحتوى مفبرك.
//
// 2026-08-14: كانت الوظيفة توثق بملف PDF يرسله المتصفح كما هو (pdfBase64) وترفقه بالإيميل
// بدون أي تحقق من محتواه — أي زبون عنده طلب حقيقي واحد (حتى أرخص صنف) يقدر يستبدل المرفق
// بأي ملف ويرسله لصندوق بريد صاحب المتجر عبر بنية الموقع نفسها. الآن الفاتورة تُبنى بالكامل
// من داخل الوظيفة اعتمادًا على بيانات الطلب/الأصناف/أسماء المنتجات المقروءة من القاعدة مباشرة —
// المتصفح ما عاد يرسل ولا يتحكم بأي جزء من ملف الـ PDF المرفق إطلاقًا.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsPDF } from "npm:jspdf@2.5.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function buildInvoicePdf(order: any, items: any[], productNames: Record<string, string>) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const marginX = 40;
  const pageBottom = 780;
  const rowHeight = 20;
  let y = 50;

  doc.setFontSize(18);
  doc.text("Machhad - Invoice", marginX, y);
  y += 26;

  doc.setFontSize(10);
  doc.text(`Order #: ${order.id}`, marginX, y); y += 16;
  doc.text(`Date: ${order.order_date ?? ""}`, marginX, y); y += 16;
  doc.text(`Customer: ${order.customer_name ?? ""}`, marginX, y); y += 16;
  doc.text(`Phone: ${order.customer_phone ?? ""}`, marginX, y); y += 16;
  doc.text(`Country: ${order.country ?? ""}`, marginX, y); y += 16;
  doc.text(`Payment method: ${order.payment ?? ""}`, marginX, y); y += 26;

  const colName = marginX;
  const colSize = 300;
  const colQty = 355;
  const colUnit = 400;
  const colSub = 480;

  const drawHeader = () => {
    doc.setFontSize(11);
    doc.text("Item", colName, y);
    doc.text("Size", colSize, y);
    doc.text("Qty", colQty, y);
    doc.text("Unit Price", colUnit, y);
    doc.text("Subtotal", colSub, y);
    y += 6;
    doc.line(marginX, y, 555, y);
    y += 16;
    doc.setFontSize(10);
  };
  drawHeader();

  let total = 0;
  for (const it of items) {
    if (y + rowHeight > pageBottom) {
      doc.addPage();
      y = 50;
      drawHeader();
    }
    const name = productNames[it.product_id] || it.product_id || "";
    const price = Number(it.price) || 0;
    const qty = Number(it.qty) || 0;
    const lineTotal = price * qty;
    total += lineTotal;

    doc.text(String(name).slice(0, 34), colName, y);
    doc.text(it.size || "-", colSize, y);
    doc.text(String(qty), colQty, y);
    doc.text(price.toFixed(2) + " USD", colUnit, y);
    doc.text(lineTotal.toFixed(2) + " USD", colSub, y);
    y += rowHeight;
  }

  y += 10;
  doc.line(marginX, y, 555, y);
  y += 20;
  doc.setFontSize(12);
  doc.text(`Total: ${total.toFixed(2)} USD`, colUnit, y);

  const dataUri = doc.output("datauristring");
  return { pdfBase64: dataUri.split(",")[1], total };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { orderId } = await req.json();
    if (!orderId) {
      throw new Error("orderId is required");
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

    // قائمة المستلمين تُدار من لوحة الإدارة (جدول invoice_recipients) — لو فاضية لأي سبب،
    // نرجع لإيميل المالك الافتراضي حتى ما تنقطع الإشعارات
    const { data: recipientRows } = await supabaseAdmin.from("invoice_recipients").select("email");
    const recipientEmails = recipientRows && recipientRows.length ? recipientRows.map((r: any) => r.email) : [OWNER_EMAIL];

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

    const productIds = [...new Set((items ?? []).map((it: any) => it.product_id).filter(Boolean))];
    const { data: productRows } = productIds.length
      ? await supabaseAdmin.from("products").select("id, name_en, name_ar").in("id", productIds)
      : { data: [] as any[] };
    const productNames: Record<string, string> = {};
    (productRows ?? []).forEach((p: any) => { productNames[p.id] = p.name_en || p.name_ar || p.id; });

    const { pdfBase64, total } = buildInvoicePdf(order, items ?? [], productNames);

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
        to: recipientEmails,
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
