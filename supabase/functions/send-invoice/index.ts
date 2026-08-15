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
//
// 2026-08-15: أعيد تصميم الفاتورة بالكامل (شعار، معلومات المتجر، صور المنتجات، جدول منظم،
// رقم فاتورة حقيقي...) عبر نفس القالب المشترك المستخدم بتنزيل الفاتورة من داخل التطبيق
// (supabase/functions/_shared/invoiceTemplate.js) — حتى يصير عندنا تصميم واحد فقط بكل مكان.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsPDF } from "npm:jspdf@2.5.2";
import { renderInvoiceDoc } from "../_shared/invoiceTemplate.js";
import { LOGO_SRC } from "../_shared/logo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// نفس قوائم البلدان/طرق الدفع وألوان حالة الطلب الموجودة بالواجهة (src/JewelryStore.jsx) —
// نسخة إنجليزية مختصرة، لأن نص الفاتورة نفسه دايمًا إنجليزي (راجع ملاحظة invoiceTemplate.js)
const COUNTRY_LABELS_EN: Record<string, string> = {
  abidjan: "Abidjan — Côte d'Ivoire",
  congo: "Congo",
  lebanon: "Lebanon",
};
const PAYMENT_LABELS_EN: Record<string, string> = {
  card: "Credit / Debit Card",
  cod: "Cash on Delivery",
  bank: "Bank Transfer",
  mobile: "Mobile Money (Orange / MTN)",
  whish: "Whish Money (Lebanon)",
};
const STATUS_LABELS_EN: Record<string, string> = {
  pending: "Pending",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};
const STATUS_COLORS: Record<string, string> = {
  pending: "#A39C92",
  processing: "#7DBFB0",
  shipped: "#7DBFB0",
  delivered: "#2E5D55",
  cancelled: "#C98A73",
};

function formatInvoiceNumber(n: number | null | undefined) {
  if (n == null) return "—";
  return "INV-" + String(n).padStart(6, "0");
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
      .select("id, order_id, product_id, qty, size, price")
      .eq("order_id", orderId);

    const productIds = [...new Set((items ?? []).map((it: any) => it.product_id).filter(Boolean))];
    // نقرأ فقط الأعمدة اللازمة لعرض الفاتورة — بدون cost ولا rep (بيانات إدارية داخلية، ما إلها مكان بفاتورة الزبون)
    const { data: productRows } = productIds.length
      ? await supabaseAdmin
          .from("products")
          .select("id, name_en, name_ar, desc_en, mat_en, barcode, images, sale_method, weight_grams, metal_type, gold_karat, silver_type")
          .in("id", productIds)
      : { data: [] as any[] };
    const productsById: Record<string, any> = {};
    (productRows ?? []).forEach((p: any) => { productsById[p.id] = p; });

    let customerEmail: string | null = null;
    if (order.customer_id) {
      const { data: customerRow } = await supabaseAdmin
        .from("customers")
        .select("email")
        .eq("id", order.customer_id)
        .maybeSingle();
      customerEmail = customerRow?.email ?? null;
    }

    const { data: siteSettings } = await supabaseAdmin
      .from("site_settings")
      .select("store_phone, store_address")
      .eq("id", 1)
      .maybeSingle();

    const invoiceItems = (items ?? []).map((it: any) => {
      const product = productsById[it.product_id] || {};
      return {
        name: product.name_en || product.name_ar || it.product_id || "",
        description: product.desc_en || product.mat_en || "",
        sku: product.barcode || "",
        qty: it.qty,
        unitPrice: Number(it.price) || 0,
        // لا نُضمّن صور المنتجات الحقيقية بالفاتورة المُرسَلة بالإيميل عمدًا: doc.addImage/getImageProperties
        // بمكتبة jsPDF (فك ترميز PNG/JPEG بجافاسكريبت بحت) يتجاوز حصة موارد Deno Edge Function هون
        // بشكل ثابت — حتى صورة اختبار 1×1 بكسل فشّلت الوظيفة بـ WORKER_RESOURCE_LIMIT، لا علاقة
        // للحجم الفعلي بالأمر. نفس القالب (invoiceTemplate.js) يرسم صندوق بديل أنيق بدل الصورة —
        // نفس الشكل يلي يظهر أصلًا لأي صنف بلا صورة. التنزيل من المتصفح يعرض الصورة الحقيقية طبيعي
        // (لا حصة موارد مشددة هناك) — فرق مقصود ومبرر تقنيًا، مو تصميم مختلف عمدًا.
        image: null,
        size: it.size || null,
        saleMethod: product.sale_method || "piece",
        weightGrams: product.weight_grams != null ? Number(product.weight_grams) : null,
        metalType: product.metal_type || null,
        goldKarat: product.gold_karat != null ? Number(product.gold_karat) : null,
        silverType: product.silver_type || null,
      };
    });

    const total = invoiceItems.reduce((sum, it) => sum + it.unitPrice * (Number(it.qty) || 0), 0);

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    renderInvoiceDoc(doc, {
      order: {
        invoiceLabel: formatInvoiceNumber(order.invoice_number),
        orderId: order.id,
        orderDate: order.order_date ?? "",
        countryLabel: COUNTRY_LABELS_EN[order.country] || order.country || "",
        paymentLabel: PAYMENT_LABELS_EN[order.payment] || order.payment || "",
        customerName: order.customer_name ?? "",
        customerPhone: order.customer_phone ?? "",
        customerEmail,
        statusLabel: STATUS_LABELS_EN[order.status] || null,
        statusColor: STATUS_COLORS[order.status] || null,
      },
      items: invoiceItems,
      storeInfo: { phone: siteSettings?.store_phone || "", address: siteSettings?.store_address || "" },
      logoSrc: LOGO_SRC,
    });
    const pdfBase64 = doc.output("datauristring").split(",")[1];

    const html = `
      <div dir="rtl" style="font-family: sans-serif;">
        <h2>طلب جديد — مشهد</h2>
        <p>رقم الطلب: ${order.id}</p>
        <p>رقم الفاتورة: ${formatInvoiceNumber(order.invoice_number)}</p>
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
        attachments: [{ filename: `invoice-${formatInvoiceNumber(order.invoice_number)}.pdf`, content: pdfBase64 }],
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
