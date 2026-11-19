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
const HEADER_TOP = 35.65;

function headerData(announcement) {
  return {
    department: announcement.department || 'Merchandising (MRC)',
    manualTitle: announcement.manual_title || 'Memorandum',
    docNo: announcement.doc_no || announcement.memo_no || '',
    ver: announcement.ver || '',
    procedureTitle: announcement.procedure_title || announcement.title || '',
    effDate: announcement.effective_date || '',
    dateCreated: announcement.date_created || (announcement.created_at || '').slice(0, 10),
    relatedDocument: announcement.related_document || '',
  };
}

function headerGeometry(top) {
  const x0 = MARGIN + (CONTENT_W - HEADER_WIDTH) / 2;
  const xs = [x0];
  HEADER_COLS.forEach((w) => xs.push(xs[xs.length - 1] + w));
  const ys = [top];
  HEADER_ROW_H.forEach((h) => ys.push(ys[ys.length - 1] + h));
  return { xs, ys };
}

function drawControlHeader(doc, top, data) {
  const { xs, ys } = headerGeometry(top);
  const x0 = xs[0];
  const stride = 5; // Word cell margin: 100 dxa = 5 pt
  const rows = [
    ['Department:', data.department, 'Doc No.', data.docNo],
    ['Manual Title:', data.manualTitle, 'Ver.', data.ver],
    ['Procedure Title:', data.procedureTitle, 'Eff. Date', data.effDate],
    ['Date Created:', data.dateCreated, 'Page', ''], // page number filled in the final pass
  ];

  doc.save();
  rows.forEach((_, r) => {
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

  rows.forEach(([label, value, sideLabel, sideValue], r) => {
    cellText(label, xs[1], HEADER_COLS[1], ys[r], HEADER_ROW_H[r], { bold: true, size: 10 });
    cellText(value, xs[2], HEADER_COLS[2], ys[r], HEADER_ROW_H[r]);
    cellText(sideLabel, xs[3], HEADER_COLS[3], ys[r], HEADER_ROW_H[r], { bold: true, size: 10 });
    cellText(sideValue, xs[4], HEADER_COLS[4], ys[r], HEADER_ROW_H[r]);
  });
  cellText('Related Document:', xs[1], HEADER_COLS[1], ys[4], HEADER_ROW_H[4], { bold: true, size: 10 });
  cellText(data.relatedDocument, xs[2], xs[5] - xs[2], ys[4], HEADER_ROW_H[4]);

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

function drawRunningHeader(doc, pageNumber, data) {
  const bottom = drawControlHeader(doc, HEADER_TOP, data);
  doc.y = bottom + 12;
  doc.x = MARGIN;
}

// Page totals are known only after layout, so "n of m" is stamped in the final pass.
function drawHeaderPageNumber(doc, pageNumber, totalPages) {
  const { xs, ys } = headerGeometry(HEADER_TOP);
  const w = HEADER_COLS[4] - 10;
  const text = `${pageNumber} of ${totalPages}`;
  doc.save();
  doc.fillColor('#000000').font('Times-Roman').fontSize(9);
  const h = doc.heightOfString(text, { width: w });
  doc.text(text, xs[4] + 5, ys[3] + (HEADER_ROW_H[3] - h) / 2, { width: w, lineGap: 0 });
  doc.restore();
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

// Signature table copied from MRC-Memo.docx (TABLE 2): 500 pt wide, 0.5 pt black
// gridlines, shaded bold header row, blank signature and Date lines.
const SIG_WIDTH = 500;
const SIG_ROW_H = [18, 35.1, 18, 18, 18.5];
const SIG_TABLE_H = SIG_ROW_H.reduce((a, b) => a + b, 0);
const SIG_HEADER_BG = '#E8E8E8';
const SIG_LABELS = ['Prepared by:', 'Reviewed by:', 'Approved by:'];

function drawSignatureTable(doc, top, signers = []) {
  const x0 = MARGIN + (CONTENT_W - SIG_WIDTH) / 2;
  const colW = SIG_WIDTH / 3;
  const xs = [x0, x0 + colW, x0 + colW * 2, x0 + SIG_WIDTH];
  const ys = [top];
  SIG_ROW_H.forEach((h) => ys.push(ys[ys.length - 1] + h));

  doc.save();
  doc.rect(x0, ys[0], SIG_WIDTH, SIG_ROW_H[0]).fill(SIG_HEADER_BG);
  doc.restore();

  SIG_LABELS.forEach((label, i) => {
    const w = colW - 10;
    doc.fillColor('#000000').font('Times-Bold').fontSize(10);
    const h = doc.heightOfString(label, { width: w });
    doc.text(label, xs[i] + 5, ys[0] + (SIG_ROW_H[0] - h) / 2, { width: w, align: 'center', lineGap: 0 });
  });

  const sigLine = '_________________________';
  SIG_LABELS.forEach((_, i) => {
    const s = signers[i] || {};
    doc.fillColor('#000000').font('Times-Roman').fontSize(10);
    if (s.name) {
      const w = colW - 14;
      const h = doc.heightOfString(s.name, { width: w });
      doc.text(s.name, xs[i] + 7, ys[1] + (ys[2] - ys[1] - 17.7 - h) / 2 + 1, { width: w, align: 'center', lineGap: 0 });
    }
    doc.text(sigLine, xs[i] + 17.3, ys[1] + 17.7, { width: colW - 20, lineBreak: false });
    if (s.position) {
      doc.font('Times-Roman').fontSize(9);
      const w = colW - 14;
      const h = doc.heightOfString(s.position, { width: w });
      doc.fillColor('#000000').text(s.position, xs[i] + 7, ys[2] + (SIG_ROW_H[2] - h) / 2, { width: w, align: 'center', lineGap: 0 });
    }
    doc.fillColor('#000000').font('Times-Roman').fontSize(10)
      .text(s.date ? `Date: ${s.date}` : 'Date: _______________', xs[i] + 5, ys[4] + 3.4, { width: colW - 10, align: 'center', lineBreak: false });
  });

  doc.save().strokeColor('#000000').lineWidth(0.5);
  const hline = (ax, bx, ay) => doc.moveTo(ax, ay).lineTo(bx, ay).stroke();
  const vline = (ax, ay, by) => doc.moveTo(ax, ay).lineTo(ax, by).stroke();
  ys.forEach((y) => hline(x0, xs[3], y));
  xs.forEach((x) => vline(x, ys[0], ys[5]));
  doc.restore();

  return ys[5];
}

function drawSignatures(doc, announcement) {
  const gap = 16;
  if (doc.y + gap + SIG_TABLE_H > BOTTOM_LIMIT) doc.addPage();
  const top = doc.y + gap;
  const signers = [
    { name: announcement.prepared_by, position: announcement.prepared_position, date: announcement.prepared_date },
    { name: announcement.reviewed_by, position: announcement.reviewed_position, date: announcement.reviewed_date },
    { name: announcement.approved_by, position: announcement.approved_position, date: announcement.approved_date },
  ];
  drawSignatureTable(doc, top, signers);
  doc.y = top + SIG_TABLE_H + 8;
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

  const data = headerData(announcement);
  let pageCount = 0;
  doc.on('pageAdded', () => {
    pageCount += 1;
    drawRunningHeader(doc, pageCount, data);
  });

  // First page: standard document control header
  pageCount = 1;
  drawRunningHeader(doc, 1, data);

  // Memo body follows MRC-Memo.docx: centred MEMORANDUM title, TO/FROM/DATE/SUBJECT
  // block, a 1 pt rule, then the red subject heading.
  const recipientCfg = RECIPIENTS[recipient] || RECIPIENTS.sales;
  const memoTop = doc.y + 14;
  doc.fillColor('#000000').font('Times-Bold').fontSize(16)
    .text('MEMORANDUM', MARGIN, memoTop, { width: CONTENT_W, align: 'center', lineBreak: false });
  doc.y = memoTop + 16 + 16;

  const routing = [
    ['TO:', recipientCfg.toLabel],
    ['FROM:', announcement.from_sender || 'Grand Majesty Pharmaceutical Inc.'],
    ['DATE:', data.effDate],
    ['SUBJECT:', announcement.title || ''],
  ];
  let ry = doc.y;
  routing.forEach(([label, value]) => {
    doc.fillColor('#000000').font('Times-Bold').fontSize(11)
      .text(label, MARGIN, ry, { width: 80, lineBreak: false });
    if (value) {
      const valueX = MARGIN + doc.widthOfString(label) + 5;
      doc.font('Times-Roman').fontSize(11)
        .text(value, valueX, ry, { width: MARGIN + CONTENT_W - valueX, lineBreak: false });
    }
    ry += 16;
  });
  doc.y = ry;

  doc.save().strokeColor('#000000').lineWidth(1)
    .moveTo(MARGIN, doc.y + 2).lineTo(MARGIN + CONTENT_W, doc.y + 2).stroke();
  doc.restore();
  doc.y += 12;

  const subjectTop = doc.y;
  doc.fillColor('#EE0000').font('Times-Bold').fontSize(16)
    .text('NEW PRODUCT ANNOUNCEMENT', MARGIN, subjectTop, { width: CONTENT_W, lineBreak: false });
  doc.y = subjectTop + 16 + 8;

  if (announcement.intro) {
    doc.fillColor(DARK).font('Helvetica').fontSize(9.5)
      .text(announcement.intro, MARGIN, doc.y, { width: CONTENT_W, lineGap: 2 });
    doc.y += 6;
  }

  doc.fillColor(RED).font('Helvetica-Bold').fontSize(10)
    .text(`PRODUCTS (${products.length})`, MARGIN, doc.y + 4, { width: CONTENT_W, characterSpacing: 1 });
  doc.y += 8;

  products.forEach((p, i) => drawProduct(doc, p, i, images, recipient));

  drawSignatures(doc, announcement);

  // Footers with page numbers; the header Page cell is stamped here too
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    drawHeaderPageNumber(doc, i + 1, range.count);
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