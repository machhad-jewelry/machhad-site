import { jsPDF } from "jspdf";

function imageFormat(dataUri) {
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,/i.exec(dataUri || "");
  if (!match) return null;
  const type = match[1].toLowerCase();
  if (type === "jpg") return "JPEG";
  return type.toUpperCase();
}

const PAGE_BOTTOM = 780;
const ROW_HEIGHT = 46;
const THUMB_SIZE = 36;

function drawCircularImage(doc, imgSrc, fmt, cx, cy, r) {
  doc.saveGraphicsState();
  doc.setDrawColor(255, 255, 255);
  doc.circle(cx, cy, r, "S");
  doc.clip();
  doc.discardPath();
  doc.addImage(imgSrc, fmt, cx - r, cy - r, r * 2, r * 2);
  doc.restoreGraphicsState();
  doc.setDrawColor(190, 160, 110);
  doc.setLineWidth(0.75);
  doc.circle(cx, cy, r, "S");
}

// يولّد فاتورة PDF بسيطة (إنجليزي/أرقام فقط لضمان التوافق مع الخط الافتراضي) مع صورة مصغّرة لكل صنف، ويعيدها كنص base64
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

  const colImg = marginX;
  const colName = marginX + THUMB_SIZE + 12;
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
  order.items.forEach((it) => {
    if (y + ROW_HEIGHT > PAGE_BOTTOM) {
      doc.addPage();
      y = 50;
      drawHeader();
    }

    const product = products.find((p) => p.id === it.id);
    const name = product ? product.name.en || product.name.ar : it.id;
    const lineTotal = it.price * it.qty;
    total += lineTotal;

    const imgSrc = product?.images?.[0];
    const fmt = imageFormat(imgSrc);
    if (fmt) {
      try {
        const r = THUMB_SIZE / 2;
        drawCircularImage(doc, imgSrc, fmt, colImg + r, y - 12 + r, r);
      } catch (err) {
        // صورة غير صالحة — نتجاهلها ونكمل بدون توقف الفاتورة
      }
    }

    const textY = y + 6;
    doc.text(String(name).slice(0, 28), colName, textY);
    doc.text(it.size || "-", colSize, textY);
    doc.text(String(it.qty), colQty, textY);
    doc.text(it.price.toFixed(2) + " USD", colUnit, textY);
    doc.text(lineTotal.toFixed(2) + " USD", colSub, textY);

    y += ROW_HEIGHT;
  });

  y += 6;
  doc.line(marginX, y, 555, y);
  y += 20;
  doc.setFontSize(12);
  doc.text(`Total: ${total.toFixed(2)} USD`, colUnit, y);

  const dataUri = doc.output("datauristring");
  return dataUri.split(",")[1];
}
