import { jsPDF } from "jspdf";

// يولّد فاتورة PDF بسيطة (إنجليزي/أرقام فقط لضمان التوافق مع الخط الافتراضي) ويعيدها كنص base64
export function generateInvoicePdf(order, products, brandName) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const marginX = 40;
  let y = 50;

  doc.setFontSize(18);
  doc.text(brandName + " - Invoice", marginX, y);
  y += 26;

  doc.setFontSize(10);
  doc.text(`Order #: ${order.id}`, marginX, y);
  y += 16;
  doc.text(`Date: ${order.date}`, marginX, y);
  y += 16;
  doc.text(`Customer: ${order.customerName}`, marginX, y);
  y += 16;
  doc.text(`Phone: ${order.customerPhone}`, marginX, y);
  y += 16;
  doc.text(`Country: ${order.country}`, marginX, y);
  y += 16;
  doc.text(`Payment method: ${order.payment}`, marginX, y);
  y += 26;

  doc.setFontSize(11);
  doc.text("Item", marginX, y);
  doc.text("Size", 260, y);
  doc.text("Qty", 330, y);
  doc.text("Unit Price", 390, y);
  doc.text("Subtotal", 480, y);
  y += 6;
  doc.line(marginX, y, 555, y);
  y += 16;

  doc.setFontSize(10);
  let total = 0;
  order.items.forEach((it) => {
    const product = products.find((p) => p.id === it.id);
    const name = product ? product.name.en || product.name.ar : it.id;
    const lineTotal = it.price * it.qty;
    total += lineTotal;
    doc.text(String(name).slice(0, 34), marginX, y);
    doc.text(it.size || "-", 260, y);
    doc.text(String(it.qty), 330, y);
    doc.text(it.price.toFixed(2) + " USD", 390, y);
    doc.text(lineTotal.toFixed(2) + " USD", 480, y);
    y += 18;
  });

  y += 10;
  doc.line(marginX, y, 555, y);
  y += 20;
  doc.setFontSize(12);
  doc.text(`Total: ${total.toFixed(2)} USD`, 390, y);

  const dataUri = doc.output("datauristring");
  return dataUri.split(",")[1];
}
