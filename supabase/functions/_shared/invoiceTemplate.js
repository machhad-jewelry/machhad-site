// قالب فاتورة الـ PDF الوحيد المستخدم بكل مكان بالموقع (تنزيل من التطبيق، معاينة الأدمن، المرفق
// بإيميل الطلب الجديد) — حتى ما يصير تصميمين مختلفين لنفس الفاتورة. الملف مستقل عن أي بيئة تشغيل
// (لا يستورد jsPDF بنفسه، ولا يستخدم أي واجهة برمجية خاصة بالمتصفح أو Deno) فبيشتغل حرفيًا بنفس
// الشكل سواء استُدعي من المتصفح (src/invoicePdf.js) أو من دالة الخادم (send-invoice/index.ts) —
// المستدعي فقط هو يلي يبني كائن jsPDF ويمرره جاهزًا.
//
// ملاحظة تصميم مهمة: محتوى النص بالفاتورة بالإنجليزي عمدًا — مكتبة jsPDF ما عندها محرك تشكيل/ترتيب
// للعربي (bidi + حروف متصلة)، فأي نص عربي خام بينكتب بأحرف منفصلة وبالاتجاه الغلط. نفس القيد كان
// السبب يلي خلّى نسخة الفاتورة القديمة بهالمشروع تستخدم الإنجليزي حصرًا. بالمقابل، ترتيب الأعمدة
// والتخطيط العام مبني بروح RTL (الصورة على اليمين، بعدها اسم الصنف، بعدها SKU، الكمية، السعر،
// المجموع — بالضبط هيك بالترتيب المطلوب) — يعني التخطيط RTL حتى لو النص نفسه إنجليزي.

const COLORS = {
  text: "#1C1C1C",
  muted: "#8A8A8A",
  accent: "#2E5D55", // نفس THEME.gold بالواجهة (لون العلامة، أخضر مزرق غامق رغم الاسم)
  divider: "#E3E0D8",
  stripe: "#F7F5F0",
  white: "#FFFFFF",
};

const MARGIN = 40;
const FOOTER_RESERVE = 40;

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function setFill(doc, hex) { const [r, g, b] = hexToRgb(hex); doc.setFillColor(r, g, b); }
function setText(doc, hex) { const [r, g, b] = hexToRgb(hex); doc.setTextColor(r, g, b); }
function setDraw(doc, hex) { const [r, g, b] = hexToRgb(hex); doc.setDrawColor(r, g, b); }

function fmtMoney(n) {
  const v = Number(n) || 0;
  return "$" + v.toFixed(2);
}

function guessImageFormat(dataUri) {
  if (!dataUri || typeof dataUri !== "string") return null;
  const m = /^data:image\/(png|jpe?g|webp);base64,/i.exec(dataUri);
  if (!m) return null;
  const type = m[1].toLowerCase();
  if (type === "png") return "PNG";
  if (type === "jpg" || type === "jpeg") return "JPEG";
  if (type === "webp") return "WEBP";
  return null;
}

// يرسم الصورة داخل صندوق ثابت مع الحفاظ على أبعادها الأصلية (contain، بدون تشويه)؛ يرجع false
// لو الصورة مفقودة/صيغتها غير مدعومة أو فشل قراءتها، حتى يرسم المستدعي بديل بسيط بدل ما يكسر الصفحة
function drawImageContain(doc, dataUri, x, y, boxW, boxH) {
  const format = guessImageFormat(dataUri);
  if (!format) return false;
  try {
    let w = boxW;
    let h = boxH;
    try {
      const props = doc.getImageProperties(dataUri);
      if (props && props.width && props.height) {
        const ratio = Math.min(boxW / props.width, boxH / props.height);
        w = props.width * ratio;
        h = props.height * ratio;
      }
    } catch (e) {
      // نتابع بالحجم الافتراضي لو تعذّرت قراءة أبعاد الصورة
    }
    doc.addImage(dataUri, format, x + (boxW - w) / 2, y + (boxH - h) / 2, w, h, undefined, "FAST");
    return true;
  } catch (e) {
    return false;
  }
}

function drawImagePlaceholder(doc, x, y, boxW, boxH) {
  setFill(doc, COLORS.stripe);
  doc.roundedRect(x, y, boxW, boxH, 3, 3, "F");
  setDraw(doc, COLORS.divider);
  doc.setLineWidth(0.6);
  doc.roundedRect(x, y, boxW, boxH, 3, 3, "S");
}

// أعمدة الجدول من اليمين لليسار: الصورة → اسم الصنف/تفاصيله → SKU → الكمية → سعر الوحدة → المجموع
function computeColumns(contentLeft, contentRight) {
  const widths = { image: 90, name: 168, sku: 72, qty: 34, unit: 68 };
  let x2 = contentRight;
  const image = { x1: x2 - widths.image, x2 }; x2 = image.x1;
  const name = { x1: x2 - widths.name, x2 }; x2 = name.x1;
  const sku = { x1: x2 - widths.sku, x2 }; x2 = sku.x1;
  const qty = { x1: x2 - widths.qty, x2 }; x2 = qty.x1;
  const unit = { x1: x2 - widths.unit, x2 }; x2 = unit.x1;
  const total = { x1: contentLeft, x2 };
  return { image, name, sku, qty, unit, total };
}

function drawHeader(doc, { order, storeInfo, logoSrc }, contentLeft, contentRight) {
  let y = MARGIN;

  const logoBoxW = 62, logoBoxH = 62;
  let logoH = 0;
  const format = guessImageFormat(logoSrc);
  if (format) {
    try {
      const props = doc.getImageProperties(logoSrc);
      const ratio = Math.min(logoBoxW / props.width, logoBoxH / props.height);
      const w = props.width * ratio, h = props.height * ratio;
      doc.addImage(logoSrc, format, contentRight - w, y, w, h, undefined, "FAST");
      logoH = h;
    } catch (e) {
      // نكمل بدون شعار لو تعذّرت قراءته
    }
  }
  y += logoH + 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  setText(doc, COLORS.text);
  doc.text("MACHHAD", contentRight, y, { align: "right" });
  y += 13;

  const contactParts = [storeInfo?.address, storeInfo?.phone, "machhadjewelry.com"].filter(Boolean);
  if (contactParts.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    setText(doc, COLORS.muted);
    doc.text(contactParts.join("   ·   "), contentRight, y, { align: "right" });
    y += 12;
  }

  y += 8;
  setDraw(doc, COLORS.divider);
  doc.setLineWidth(0.75);
  doc.line(contentLeft, y, contentRight, y);
  y += 22;

  let ry = y;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  setText(doc, COLORS.accent);
  doc.text("INVOICE", contentRight, ry, { align: "right" });
  ry += 15;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const invoiceLines = [
    ["Invoice #", order.invoiceLabel],
    ["Order #", order.orderId],
    ["Date", order.orderDate],
    ["Payment Method", order.paymentLabel],
  ];
  invoiceLines.forEach(([label, value]) => {
    if (!value) return;
    setText(doc, COLORS.text);
    doc.text(`${label}: ${value}`, contentRight, ry, { align: "right" });
    ry += 13;
  });
  if (order.statusLabel) {
    setText(doc, order.statusColor || COLORS.accent);
    doc.text(`Status: ${order.statusLabel}`, contentRight, ry, { align: "right" });
    ry += 13;
  }

  let ly = y;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  setText(doc, COLORS.accent);
  doc.text("BILL TO", contentLeft, ly, { align: "left" });
  ly += 15;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  setText(doc, COLORS.text);
  if (order.customerName) { doc.text(order.customerName, contentLeft, ly, { align: "left" }); ly += 13; }
  doc.setFontSize(9);
  setText(doc, COLORS.muted);
  [order.customerPhone, order.customerEmail, order.countryLabel].filter(Boolean).forEach((line) => {
    doc.text(line, contentLeft, ly, { align: "left" });
    ly += 12;
  });

  y = Math.max(ry, ly) + 10;
  setDraw(doc, COLORS.divider);
  doc.setLineWidth(0.75);
  doc.line(contentLeft, y, contentRight, y);
  return y + 18;
}

function drawContinuationHeader(doc, order, contentLeft, contentRight) {
  let y = MARGIN;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  setText(doc, COLORS.text);
  doc.text("MACHHAD", contentLeft, y, { align: "left" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setText(doc, COLORS.muted);
  doc.text(`Invoice ${order.invoiceLabel} (continued)`, contentRight, y, { align: "right" });
  y += 10;
  setDraw(doc, COLORS.divider);
  doc.setLineWidth(0.5);
  doc.line(contentLeft, y, contentRight, y);
  return y + 20;
}

function drawTableHeader(doc, y, cols) {
  const h = 22;
  setFill(doc, COLORS.accent);
  doc.rect(cols.total.x1, y, cols.image.x2 - cols.total.x1, h, "F");
  setText(doc, COLORS.white);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  const midY = y + h / 2 + 3;
  doc.text("TOTAL", cols.total.x2 - 6, midY, { align: "right" });
  doc.text("UNIT PRICE", cols.unit.x2 - 6, midY, { align: "right" });
  doc.text("QTY", (cols.qty.x1 + cols.qty.x2) / 2, midY, { align: "center" });
  doc.text("SKU", cols.sku.x1 + 6, midY, { align: "left" });
  doc.text("PRODUCT", cols.name.x1 + 6, midY, { align: "left" });
  return y + h;
}

// سطر تفاصيل إضافي تحت اسم الصنف — فقط للحقول الموجودة فعليًا بالصنف (وزن/عيار ذهب أو نوع فضة،
// مقاس لو الصنف له مقاس، وعدد/مقاس حبات المسبحة لو موجودين)، ما بتظهر أي خانة فاضية
function buildMetaLine(item) {
  const parts = [];
  if (item.saleMethod === "weight") {
    if (item.weightGrams) parts.push(`Weight: ${item.weightGrams}g`);
    if (item.metalType === "gold" && item.goldKarat) parts.push(`Gold ${item.goldKarat}K`);
    else if (item.metalType === "silver" && item.silverType) {
      parts.push(`Silver — ${item.silverType === "male" ? "Men" : "Women"}`);
    }
  }
  if (item.size) parts.push(`Size: ${item.size}`);
  if (item.beadCount) parts.push(`Beads: ${item.beadCount}`);
  if (item.beadSize) parts.push(`Bead Size: ${item.beadSize}`);
  return parts.join("   ·   ");
}

function measureRow(doc, item, cols) {
  const nameWidth = cols.name.x2 - cols.name.x1 - 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  const nameLines = doc.splitTextToSize(String(item.name || "-"), nameWidth).slice(0, 2);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const descLines = item.description
    ? doc.splitTextToSize(String(item.description), nameWidth).slice(0, 1)
    : [];

  const meta = buildMetaLine(item);

  // ملاحظة مقاس خاص طلبها الزبون عند الدفع (فقط لمنتجات لبنان اللي بتسمح بتعديل المقاس) — نص حر
  // ممكن يطول، فمنسمح له بسطرين كحد أقصى بعكس سطر الـ meta المضبوط
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  const noteLines = item.sizeNote
    ? doc.splitTextToSize(`Note: ${item.sizeNote}`, nameWidth).slice(0, 2)
    : [];

  let textH = 14 + nameLines.length * 11.5;
  if (descLines.length) textH += 11;
  if (meta) textH += 11;
  if (noteLines.length) textH += 11 * noteLines.length;
  textH += 10;

  const imageBoxH = 58;
  return { height: Math.max(imageBoxH + 14, textH), nameLines, descLines, meta, noteLines };
}

function drawRow(doc, y, measured, item, cols, striped) {
  const height = measured.height;
  if (striped) {
    setFill(doc, COLORS.stripe);
    doc.rect(cols.total.x1, y, cols.image.x2 - cols.total.x1, height, "F");
  }

  const imgBoxW = 54, imgBoxH = 54;
  const imgX = cols.image.x1 + (cols.image.x2 - cols.image.x1 - imgBoxW) / 2;
  const imgY = y + (height - imgBoxH) / 2;
  const drew = item.image ? drawImageContain(doc, item.image, imgX, imgY, imgBoxW, imgBoxH) : false;
  if (!drew) drawImagePlaceholder(doc, imgX, imgY, imgBoxW, imgBoxH);

  const textX = cols.name.x1 + 6;
  let ty = y + 15;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  setText(doc, COLORS.text);
  measured.nameLines.forEach((line) => { doc.text(line, textX, ty, { align: "left" }); ty += 11.5; });

  if (measured.descLines.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setText(doc, COLORS.muted);
    measured.descLines.forEach((line) => { doc.text(line, textX, ty, { align: "left" }); ty += 11; });
  }
  if (measured.meta) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setText(doc, COLORS.accent);
    doc.text(measured.meta, textX, ty, { align: "left" });
    ty += 11;
  }
  if (measured.noteLines.length) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    setText(doc, COLORS.accent);
    measured.noteLines.forEach((line) => { doc.text(line, textX, ty, { align: "left" }); ty += 11; });
  }

  const midY = y + height / 2 + 3;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  setText(doc, COLORS.text);
  doc.text(item.sku || "—", cols.sku.x1 + 6, midY, { align: "left" });
  doc.text(String(item.qty), (cols.qty.x1 + cols.qty.x2) / 2, midY, { align: "center" });
  doc.text(fmtMoney(item.unitPrice), cols.unit.x2 - 6, midY, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.text(fmtMoney((Number(item.unitPrice) || 0) * (Number(item.qty) || 0)), cols.total.x2 - 6, midY, { align: "right" });

  setDraw(doc, COLORS.divider);
  doc.setLineWidth(0.4);
  doc.line(cols.total.x1, y + height, cols.image.x2, y + height);
}

// صندوق الإجمالي أسفل الجدول — يعرض فقط الأسطر يلي عندها بيانات فعلية (لا خصم/شحن/ضريبة حاليًا
// بالنظام، فما بتنعرض)، والمجموع الكلي أكبر وأوضح داخل صندوق بلون العلامة
function drawTotals(doc, y, subtotal, cols) {
  const boxW = 220;
  const boxX2 = cols.image.x2;
  const boxX1 = boxX2 - boxW;
  let ty = y + 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  setText(doc, COLORS.text);
  doc.text("Subtotal", boxX1 + 4, ty, { align: "left" });
  doc.text(fmtMoney(subtotal), boxX2, ty, { align: "right" });
  ty += 12;

  setDraw(doc, COLORS.divider);
  doc.setLineWidth(0.5);
  doc.line(boxX1, ty, boxX2, ty);
  ty += 14;

  const totalBoxH = 32;
  setFill(doc, COLORS.accent);
  doc.rect(boxX1, ty, boxW, totalBoxH, "F");
  setText(doc, COLORS.white);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("TOTAL", boxX1 + 14, ty + totalBoxH / 2 + 4, { align: "left" });
  doc.setFontSize(15);
  doc.text(fmtMoney(subtotal), boxX2 - 14, ty + totalBoxH / 2 + 5, { align: "right" });

  return ty + totalBoxH;
}

function finalizeFooters(doc, storeInfo, contentLeft, contentRight, pageH) {
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const y = pageH - 34;
    setDraw(doc, COLORS.divider);
    doc.setLineWidth(0.5);
    doc.line(contentLeft, y, contentRight, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    setText(doc, COLORS.muted);
    const footerParts = ["Machhad", storeInfo?.phone, "machhadjewelry.com"].filter(Boolean);
    doc.text(footerParts.join("   ·   "), contentLeft, y + 14, { align: "left" });
    doc.text("Thank you for shopping with Machhad", (contentLeft + contentRight) / 2, y + 14, { align: "center" });
    doc.text(`Page ${i} of ${totalPages}`, contentRight, y + 14, { align: "right" });
  }
}

// نقطة الدخول الوحيدة — doc لازم يكون jsPDF جاهز (new jsPDF({unit:"pt", format:"a4"})) مبني من
// طرف المستدعي (كل بيئة عندها طريقة استيراد jsPDF مختلفة). البيانات المطلوبة:
//   order: { invoiceLabel, orderId, orderDate, countryLabel, paymentLabel, customerName,
//            customerPhone, customerEmail, statusLabel, statusColor }
//   items: [{ name, description, sku, qty, unitPrice, image, size, sizeNote, saleMethod,
//             weightGrams, metalType, goldKarat, silverType, beadCount, beadSize }]
//   storeInfo: { phone, address }
//   logoSrc: نص Data URI للشعار
export function renderInvoiceDoc(doc, { order, items, storeInfo, logoSrc }) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentLeft = MARGIN;
  const contentRight = pageW - MARGIN;
  const cols = computeColumns(contentLeft, contentRight);
  const pageBottom = pageH - FOOTER_RESERVE - 26;

  let y = drawHeader(doc, { order, storeInfo, logoSrc }, contentLeft, contentRight);
  y = drawTableHeader(doc, y, cols);

  let subtotal = 0;
  const list = items && items.length ? items : [];
  if (!list.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setText(doc, COLORS.muted);
    doc.text("No items", cols.name.x1 + 6, y + 16, { align: "left" });
    y += 30;
  }
  list.forEach((item, idx) => {
    const measured = measureRow(doc, item, cols);
    if (y + measured.height > pageBottom) {
      doc.addPage();
      y = drawContinuationHeader(doc, order, contentLeft, contentRight);
      y = drawTableHeader(doc, y, cols);
    }
    drawRow(doc, y, measured, item, cols, idx % 2 === 1);
    y += measured.height;
    subtotal += (Number(item.unitPrice) || 0) * (Number(item.qty) || 0);
  });

  if (y + 80 > pageBottom) {
    doc.addPage();
    y = drawContinuationHeader(doc, order, contentLeft, contentRight);
  }
  drawTotals(doc, y, subtotal, cols);

  finalizeFooters(doc, storeInfo, contentLeft, contentRight, pageH);
  return doc;
}
