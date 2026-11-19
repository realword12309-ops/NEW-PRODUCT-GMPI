const PDFDocument = require('pdfkit');
const path = require('node:path');
const fs = require('node:fs');

const RED = '#C8102E';
const DARK = '#1A1A1A';
const GRAY = '#666666';
const LIGHT = '#F6F6F6';
const BORDER = '#E0E0E0';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 42;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM_LIMIT = PAGE_H - 62;
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'majesty-pharma-logo.png');

// Standard MRC document control header. Geometry, borders and typography are
// measured from the Word render of MRC-Memo.docx: 500 pt table, 0.5 pt black
// gridlines, 10 pt Times-Bold labels, 9 pt Times values, logo merged rows 1-4.
const HEADER_WIDTH = 500;
const HEADER_COLS = [100, 97.75, 144, 45, 113.25];
const HEADER_ROW_H = [15, 15, 26.5, 15, 15]; // row 3 wraps "Eff. Date" like Word
const HEADER_LABEL_BG = '#F2F2F2';
const HEADER_LOGO = { w: 88.5, h: 39.75, top: 23.6 };
const HEADER_ROWS = [
  ['Department:', 'Merchandising (MRC)', 'Doc No.', ''],
  ['Manual Title:', 'Memorandum', 'Ver.', ''],
  ['Procedure Title:', '', 'Eff. Date', ''],
  ['Date Created:', '', 'Page', ''],
];

function drawControlHeader(doc, top = 35.65) {
  const x0 = MARGIN + (CONTENT_W - HEADER_WIDTH) / 2;
  const xs = [x0];
  HEADER_COLS.forEach((w) => xs.push(xs[xs.length - 1] + w));
  const ys = [top];
  HEADER_ROW_H.forEach((h) => ys.push(ys[ys.length - 1] + h));
  const stride = 5; // Word cell margin: 100 dxa = 5 pt

  doc.save();
  HEADER_ROWS.forEach((_, r) => {
    doc.rect(xs[1], ys[r], HEADER_COLS[1], HEADER_ROW_H[r]).fill(HEADER_LABEL_BG);
    doc.rect(xs[3], ys[r], HEADER_COLS[3], HEADER_ROW_H[r]).fill(HEADER_LABEL_BG);
  });
  doc.restore();

  doc.image(LOGO_PATH, xs[0] + (HEADER_COLS[0] - HEADER_LOGO.w) / 2, top + HEADER_LOGO.top, {
    width: HEADER_LOGO.w,
    height: HEADER_LOGO.h,
  });

  const cellText = (text, cx, cw, cy, ch, { bold = false, size = 9 } = {}) => {
    if (!text) return;
    doc.fillColor('#000000').font(bold ? 'Times-Bold' : 'Times-Roman').fontSize(size);
    const w = cw - stride * 2;
    const h = doc.heightOfString(text, { width: w });
    doc.text(text, cx + stride, cy + (ch - h) / 2, { width: w, lineGap: 0 });
  };

  HEADER_ROWS.forEach(([label, value, sideLabel, sideValue], r) => {
    cellText(label, xs[1], HEADER_COLS[1], ys[r], HEADER_ROW_H[r], { bold: true, size: 10 });
    cellText(value, xs[2], HEADER_COLS[2], ys[r], HEADER_ROW_H[r]);
    cellText(sideLabel, xs[3], HEADER_COLS[3], ys[r], HEADER_ROW_H[r], { bold: true, size: 10 });
    cellText(sideValue, xs[4], HEADER_COLS[4], ys[r], HEADER_ROW_H[r]);
  });
  cellText('Related Document:', xs[1], HEADER_COLS[1], ys[4], HEADER_ROW_H[4], { bold: true, size: 10 });

  doc.save().strokeColor('#000000').lineWidth(0.5);
  const hline = (ax, bx, ay) => doc.moveTo(ax, ay).lineTo(bx, ay).stroke();
  const vline = (ax, ay, by) => doc.moveTo(ax, ay).lineTo(ax, by).stroke();
  hline(x0, xs[5], ys[0]);
  hline(xs[1], xs[5], ys[1]);
  hline(xs[1], xs[5], ys[2]);
  hline(xs[1], xs[5], ys[3]);
  hline(x0, xs[5], ys[4]);
  hline(x0, xs[5], ys[5]);
  vline(xs[0], ys[0], ys[5]);
  vline(xs[1], ys[0], ys[5]);
  vline(xs[2], ys[0], ys[5]);
  vline(xs[3], ys[0], ys[4]);
  vline(xs[4], ys[0], ys[4]);
  vline(xs[5], ys[0], ys[5]);
  doc.restore();

  return ys[5];
}

function drawRunningHeader(doc, pageNumber) {
  const bottom = drawControlHeader(doc);
  doc.y = bottom + 12;
  doc.x = MARGIN;
}

// One master design; the recipient only changes which pricing columns are shown.
const RECIPIENTS = {
  sales: {
    filename: 'sales-team',
    toLabel: 'SALES TEAM',
    fields: (p) => [
      ['PACKAGING', p.packaging],
      ['SRP', p.srp],
      ['DISCOUNT (%)', p.discount],
      ['TRADE PRICE W/ VAT (PHP)', p.trade_price],
      ['PRICE 3', p.price3],
    ],
  },
  stores: {
    filename: 'stores',
    toLabel: 'STORES',
    fields: (p) => [
      ['PACKAGING', p.packaging],
      ['UOM GROUP NAME', p.uom_group_name],
      ['RETAIL PRICE', p.retail_price],
    ],
  },
  customers: {
    filename: 'valued-customers',
    toLabel: 'OUR VALUED CUSTOMERS',
    fields: (p) => [
      ['PACKAGING', p.packaging],
      ['UOM GROUP NAME', p.uom_group_name],
      ['PRICE 3', p.price3],
    ],
  },
};

function pricingFields(p, recipient) {
  return (RECIPIENTS[recipient] || RECIPIENTS.sales).fields(p);
}

function hasPricing(p, recipient) {
  return pricingFields(p, recipient).some(([, v]) => v);
}

function pricingMetrics(doc, p, width, recipient) {
  const fields = pricingFields(p, recipient);
  const cellW = (width - 12 - 8 * (fields.length - 1)) / fields.length;
  let labelH = 0;
  let valueH = 0;
  for (const [label, value] of fields) {
    doc.font('Helvetica').fontSize(6.5);
    labelH = Math.max(labelH, doc.heightOfString(label, { width: cellW }));
    doc.font('Helvetica-Bold').fontSize(9.5);
    valueH = Math.max(valueH, doc.heightOfString(value || '—', { width: cellW }));
  }
  return { cellW, labelH, valueH, stripH: 7 + labelH + 2 + valueH + 7 };
}

function productTextHeight(doc, p, textWidth, recipient) {
  doc.font('Helvetica-Bold').fontSize(10.5);
  const codeH = doc.heightOfString(p.item_code, { width: textWidth });
  doc.font('Helvetica-Bold').fontSize(10);
  const descH = doc.heightOfString(p.item_description, { width: textWidth });
  doc.font('Helvetica').fontSize(9.5);
  const shortH = p.short_description
    ? doc.heightOfString(p.short_description, { width: textWidth, lineGap: 1.5 })
    : 0;
  const pricingH = hasPricing(p, recipient) ? pricingMetrics(doc, p, textWidth, recipient).stripH + 7 : 0;
  return codeH + 3 + descH + (shortH ? 4 + shortH : 0) + pricingH;
}

// images is either an uploads directory path (local dev) or a Map of filename -> Buffer
// (production, images stored in PostgreSQL). pdfkit accepts both paths and Buffers.
function resolveImage(images, imagePath) {
  if (!imagePath) return null;
  const name = path.basename(imagePath);
  if (typeof images === 'string') {
    const p = path.join(images, name);
    return fs.existsSync(p) ? p : null;
  }
  return images.get(name) || null;
}

function drawProduct(doc, p, index, images, recipient) {
  const pad = 10;
  const imgSize = 88;
  const img = resolveImage(images, p.image_path);
  const hasImage = Boolean(img);
  const textX = MARGIN + pad + (hasImage ? imgSize + 12 : 0);
  const textWidth = CONTENT_W - pad * 2 - (hasImage ? imgSize + 12 : 0) - 26;
  const textH = productTextHeight(doc, p, textWidth, recipient);
  const blockH = Math.max(textH, hasImage ? imgSize : 0) + pad * 2;

  if (doc.y + blockH > BOTTOM_LIMIT) {
    doc.addPage();
  }

  const y = doc.y;
  doc.save();
  doc.roundedRect(MARGIN, y, CONTENT_W, blockH, 4).fillAndStroke(LIGHT, BORDER);
  doc.rect(MARGIN, y, 3.5, blockH).fill(RED);
  doc.restore();

  doc.fillColor(GRAY).font('Helvetica-Bold').fontSize(9)
    .text(String(index + 1).padStart(3, '0'), MARGIN + CONTENT_W - 30, y + pad, { width: 22, align: 'right' });

  if (hasImage) {
    try {
      doc.image(img, MARGIN + pad, y + pad, {
        fit: [imgSize, imgSize],
        align: 'center',
        valign: 'center',
      });
    } catch (e) {
      console.error(`PDF image render failed for item ${p.item_code} (${p.image_path}): ${e.message}`);
    }
  }

  let ty = y + pad;
  doc.fillColor(RED).font('Helvetica-Bold').fontSize(10.5)
    .text(p.item_code, textX, ty, { width: textWidth });
  ty = doc.y + 3;
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10)
    .text(p.item_description, textX, ty, { width: textWidth });
  ty = doc.y;
  if (p.short_description) {
    doc.fillColor(GRAY).font('Helvetica').fontSize(9.5)
      .text(p.short_description, textX, ty + 4, { width: textWidth, lineGap: 1.5 });
    ty = doc.y;
  }

  if (hasPricing(p, recipient)) {
    const m = pricingMetrics(doc, p, textWidth, recipient);
    const stripY = ty + 7;
    doc.save();
    doc.roundedRect(textX, stripY, textWidth, m.stripH, 3).fill('#FFFFFF');
    doc.restore();
    pricingFields(p, recipient).forEach(([label, value], i) => {
      const cx = textX + 6 + i * (m.cellW + 8);
      const cw = m.cellW;
      doc.fillColor(GRAY).font('Helvetica').fontSize(6.5)
        .text(label, cx, stripY + 7, { width: cw });
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(9.5)
        .text(value || '—', cx, stripY + 7 + m.labelH + 2, { width: cw });
    });
  }

  doc.y = y + blockH + 8;
  doc.x = MARGIN;
}

function drawSignatures(doc) {
  const needed = 128;
  if (doc.y + needed > BOTTOM_LIMIT) doc.addPage();

  const y = doc.y + 14;
  doc.save();
  doc.moveTo(MARGIN, y - 6).lineTo(PAGE_W - MARGIN, y - 6).strokeColor(BORDER).lineWidth(1).stroke();
  doc.restore();

  const gap = 26;
  const colW = (CONTENT_W - gap * 2) / 3;
  const blocks = [
    { label: 'Prepared By:', name: 'BRIXZEL M. FLORES', position: 'MMA', x: MARGIN },
    { label: 'Approved By:', name: 'EVONA PAULA MARIQUIT', position: 'Merchandising Manager', x: MARGIN + colW + gap },
    { label: 'Approved By:', name: 'RASHEL L. NACOR', position: 'Merchandising Manager', x: MARGIN + (colW + gap) * 2 },
  ];
  for (const b of blocks) {
    doc.fillColor(GRAY).font('Helvetica').fontSize(9).text(b.label, b.x, y + 4, { width: colW });
    doc.save();
    doc.moveTo(b.x, y + 52).lineTo(b.x + colW, y + 52).strokeColor(DARK).lineWidth(0.8).stroke();
    doc.restore();
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10)
      .text(b.name, b.x, y + 58, { width: colW });
    doc.fillColor(GRAY).font('Helvetica').fontSize(8.5)
      .text(b.position, b.x, y + 72, { width: colW });
  }
  doc.y = y + needed - 14;
  doc.x = MARGIN;
}

function generateMemo(announcement, products, images, recipient = 'sales') {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    bufferPages: true,
    info: {
      Title: announcement.title,
      Subject: 'New Product Announcement',
      Author: announcement.prepared_by || 'New Product Cascading System',
    },
  });

  let pageCount = 0;
  doc.on('pageAdded', () => {
    pageCount += 1;
    drawRunningHeader(doc, pageCount);
  });

  // First page: standard document control header
  pageCount = 1;
  drawRunningHeader(doc, 1);

  // Meta row
  const created = (announcement.created_at || '').slice(0, 10);
  const meta = [
    ['Memo No.', announcement.memo_no || '—'],
    ['Date', created || '—'],
    ['Effective Date', announcement.effective_date || '—'],
  ];
  const metaW = CONTENT_W / 3;
  const metaY = doc.y;
  meta.forEach(([label, value], i) => {
    const x = MARGIN + i * metaW;
    doc.fillColor(GRAY).font('Helvetica').fontSize(8).text(label.toUpperCase(), x, metaY, { width: metaW - 10, characterSpacing: 0.8 });
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10).text(value, x, metaY + 12, { width: metaW - 10 });
  });
  doc.y = metaY + 32;

  // TO / FROM routing block — TO is auto-assigned per recipient version.
  const toValue = (RECIPIENTS[recipient] || RECIPIENTS.sales).toLabel;
  const fromValue = announcement.from_sender || 'Grand Majesty Pharmaceutical Inc.';
  const routeY = doc.y;
  const toW = CONTENT_W * 0.42;
  const fromW = CONTENT_W - toW - 18;
  doc.font('Helvetica-Bold').fontSize(10);
  const routeH = Math.max(
    doc.heightOfString(toValue, { width: toW }),
    doc.heightOfString(fromValue, { width: fromW })
  );
  doc.fillColor(GRAY).font('Helvetica').fontSize(8)
    .text('TO:', MARGIN, routeY, { width: toW, characterSpacing: 0.8 });
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10)
    .text(toValue, MARGIN, routeY + 12, { width: toW });
  doc.fillColor(GRAY).font('Helvetica').fontSize(8)
    .text('FROM:', MARGIN + toW + 18, routeY, { width: fromW, characterSpacing: 0.8 });
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10)
    .text(fromValue, MARGIN + toW + 18, routeY + 12, { width: fromW });
  doc.y = routeY + 12 + routeH + 10;

  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(14)
    .text(announcement.title, MARGIN, doc.y, { width: CONTENT_W });
  doc.y += 6;

  if (announcement.intro) {
    doc.fillColor(DARK).font('Helvetica').fontSize(9.5)
      .text(announcement.intro, MARGIN, doc.y, { width: CONTENT_W, lineGap: 2 });
    doc.y += 6;
  }

  doc.fillColor(RED).font('Helvetica-Bold').fontSize(10)
    .text(`PRODUCTS (${products.length})`, MARGIN, doc.y + 4, { width: CONTENT_W, characterSpacing: 1 });
  doc.y += 8;

  products.forEach((p, i) => drawProduct(doc, p, i, images, recipient));

  drawSignatures(doc);

  // Footers with page numbers
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.save();
    doc.fillColor(GRAY).font('Helvetica').fontSize(8)
      .text(
        `Page ${i + 1} of ${range.count}`,
        MARGIN, PAGE_H - 40,
        { width: CONTENT_W, align: 'right', lineBreak: false }
      );
    doc.fillColor(GRAY).font('Helvetica').fontSize(8)
      .text('New Product Cascading System', MARGIN, PAGE_H - 40, { width: CONTENT_W, align: 'left', lineBreak: false });
    doc.restore();
  }

  doc.end();
  return doc;
}

module.exports = { generateMemo, RECIPIENTS };