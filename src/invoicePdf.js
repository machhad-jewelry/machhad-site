// يبني ملف فاتورة PDF بنفس التصميم المستخدم بكل مكان بالموقع (نفس القالب المستخدم من دالة
// send-invoice الخادمية أيضًا — راجع supabase/functions/_shared/invoiceTemplate.js). هذا الملف
// فقط "غلاف" خاص بالمتصفح: يبني كائن jsPDF ويجهّز شكل البيانات من حالة الواجهة (منتجات/طلب)
// قبل ما يمرّرها للقالب المشترك.
import { jsPDF } from "jspdf";
import { renderInvoiceDoc } from "../supabase/functions/_shared/invoiceTemplate.js";

export function formatInvoiceNumber(n) {
  if (n == null) return "—";
  return "INV-" + String(n).padStart(6, "0");
}

// invoiceTemplate.js (المشترك مع دالة send-invoice الخادمية) بيتعرّف فقط على data: URIs جاهزة —
// صور المنتجات صارت روابط Supabase Storage (راجع خطة الانتقال من base64)، فلازم نجيب البايتات
// ونحوّلها base64 هون بالمتصفح قبل ما نمرّرها للقالب المشترك (القالب نفسه يبقى بدون أي معرفة
// ببيئة التشغيل، بدون fetch، تمامًا متل ما كان مصمّم من الأساس)
async function imageUrlToDataUri(url) {
  if (!url || typeof url !== "string") return null;
  if (url.startsWith("data:")) return url;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("read failed"));
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function buildLineItems(order, products) {
  return Promise.all((order.items || []).map(async (it) => {
    const product = products.find((p) => p.id === it.id) || null;
    return {
      name: (product?.name?.en || product?.name?.ar || it.id || "").toString(),
      description: product?.desc?.en || product?.mat?.en || "",
      sku: product?.barcode || "",
      qty: it.qty,
      unitPrice: it.price,
      image: await imageUrlToDataUri(product?.images?.[0]),
      size: it.size || null,
      sizeNote: it.sizeNote || null,
      saleMethod: product?.saleMethod || "piece",
      weightGrams: product?.weightGrams || null,
      metalType: product?.metalType || null,
      goldKarat: product?.goldKarat || null,
      silverType: product?.silverType || null,
      beadCount: product?.beadCount || null,
      beadSize: product?.beadSize || null,
    };
  }));
}

// order: كائن الطلب بشكل الواجهة (orderRowToApp)، products: قائمة المنتجات المحمّلة بالواجهة حاليًا
// (تحتوي الحقول اللازمة للفاتورة، بدون cost/rep — القالب المشترك أصلًا ما بيعرض هالحقلين)
export async function buildInvoiceDoc({ order, products, storeInfo, logoSrc, countryLabel, paymentLabel, statusLabel, statusColor, customerEmail }) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  renderInvoiceDoc(doc, {
    order: {
      invoiceLabel: formatInvoiceNumber(order.invoiceNumber),
      orderId: order.id,
      orderDate: order.date,
      countryLabel,
      paymentLabel,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerEmail: customerEmail || null,
      statusLabel: statusLabel || null,
      statusColor: statusColor || null,
    },
    items: await buildLineItems(order, products),
    storeInfo,
    logoSrc,
  });
  return doc;
}

export async function downloadInvoicePdf(args) {
  const doc = await buildInvoiceDoc(args);
  doc.save(`invoice-${formatInvoiceNumber(args.order.invoiceNumber)}.pdf`);
}
