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

function buildLineItems(order, products) {
  return (order.items || []).map((it) => {
    const product = products.find((p) => p.id === it.id) || null;
    return {
      name: (product?.name?.en || product?.name?.ar || it.id || "").toString(),
      description: product?.desc?.en || product?.mat?.en || "",
      sku: product?.barcode || "",
      qty: it.qty,
      unitPrice: it.price,
      image: product?.images?.[0] || null,
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
  });
}

// order: كائن الطلب بشكل الواجهة (orderRowToApp)، products: قائمة المنتجات المحمّلة بالواجهة حاليًا
// (تحتوي الحقول اللازمة للفاتورة، بدون cost/rep — القالب المشترك أصلًا ما بيعرض هالحقلين)
export function buildInvoiceDoc({ order, products, storeInfo, logoSrc, countryLabel, paymentLabel, statusLabel, statusColor, customerEmail }) {
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
    items: buildLineItems(order, products),
    storeInfo,
    logoSrc,
  });
  return doc;
}

export function downloadInvoicePdf(args) {
  const doc = buildInvoiceDoc(args);
  doc.save(`invoice-${formatInvoiceNumber(args.order.invoiceNumber)}.pdf`);
}
