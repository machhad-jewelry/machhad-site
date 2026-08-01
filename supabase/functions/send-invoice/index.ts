// Supabase Edge Function: يرسل إيميل لصاحب المتجر مع فاتورة PDF مرفقة عند كل طلب جديد
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { orderId, customerName, customerPhone, country, payment, total, pdfBase64 } = await req.json();

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const OWNER_EMAIL = Deno.env.get("OWNER_EMAIL") ?? "rachad.fakouri@gmail.com";

    if (!RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not configured");
    }

    const html = `
      <div dir="rtl" style="font-family: sans-serif;">
        <h2>طلب جديد — مشهد</h2>
        <p>رقم الطلب: ${orderId}</p>
        <p>الزبون: ${customerName} — ${customerPhone}</p>
        <p>البلد: ${country}</p>
        <p>طريقة الدفع: ${payment}</p>
        <p>الإجمالي: ${total} USD</p>
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
        subject: `طلب جديد #${orderId} — مشهد`,
        html,
        attachments: [{ filename: `invoice-${orderId}.pdf`, content: pdfBase64 }],
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
