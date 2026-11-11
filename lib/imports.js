const ExcelJS = require('exceljs');
const Papa = require('papaparse');

const HEADER_ALIASES = {
  item_code: ['itemcode', 'item code', 'item_code', 'code', 'productcode', 'product code', 'sku'],
  item_description: ['itemdescription', 'item description', 'item_description', 'description', 'productdescription', 'product description', 'product name', 'item name'],
  short_description: ['shortdescription', 'short description', 'short_description', 'short desc', 'shortdesc', 'remarks', 'details'],
  packaging: ['packaging', 'packing', 'pack', 'package', 'pack size', 'packsize', 'unit'],
  srp: ['srp', 'suggested retail price', 'price'],
  discount: ['discount', 'discount (%)', 'discount percent', 'discount percentage', 'disc'],
  trade_price: ['trade price w/ vat (php)', 'trade price w vat php', 'trade price with vat (php)', 'trade price w/ vat', 'trade price with vat', 'trade price', 'tradeprice'],
  price3: ['price 3', 'price3', 'price three'],
  uom_group_name: ['uom group name', 'uom group', 'uom', 'unit of measure group name', 'unit of measure group', 'unit of measure'],
  retail_price: ['retail price', 'retail'],
};

function normalizeHeader(h) {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mapHeaders(headers) {
  const map = {};
  const normalized = headers.map(normalizeHeader);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = normalized.findIndex((h) => aliases.some((a) => normalizeHeader(a) === h));
    if (idx !== -1) map[field] = idx;
  }
  return map;
}

function cellToString(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text !== undefined) return String(v.text);
    if (v.result !== undefined) return String(v.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v);
  }
  return String(v).trim();
}

async function parseSpreadsheet(buffer, filename) {
  const ext = filename.toLowerCase().split('.').pop();
  let rawRows;
  if (ext === 'csv') {
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    const parsed = Papa.parse(text, { skipEmptyLines: 'greedy' });
    rawRows = parsed.data.map((r) => r.map((c) => String(c ?? '').trim()));
  } else if (ext === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    if (!ws) return { headers: [], rows: [] };
    rawRows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        values[colNumber - 1] = cellToString(cell.value);
      });
      if (values.some((v) => v !== '' && v !== undefined)) rawRows.push(values);
    });
  } else {
    throw Object.assign(new Error('Unsupported file type. Upload .xlsx or .csv files only.'), { status: 400 });
  }
  if (rawRows.length === 0) return { headers: [], rows: [] };
  const headers = rawRows[0].map((h) => String(h ?? '').trim());
  return { headers, rows: rawRows.slice(1) };
}

const REQUIRED_FIELDS = ['item_code', 'item_description', 'short_description'];
const OPTIONAL_FIELDS = ['packaging', 'srp', 'discount', 'trade_price', 'price3', 'uom_group_name', 'retail_price'];

function validateRows(headers, rows) {
  const map = mapHeaders(headers);
  const missingColumns = REQUIRED_FIELDS.filter((f) => map[f] === undefined);
  const seen = new Map();
  const items = rows.map((row, i) => {
    const item = {
      row: i + 2,
      item_code: map.item_code !== undefined ? String(row[map.item_code] ?? '').trim() : '',
      item_description: map.item_description !== undefined ? String(row[map.item_description] ?? '').trim() : '',
      short_description: map.short_description !== undefined ? String(row[map.short_description] ?? '').trim() : '',
      errors: [],
    };
    for (const f of OPTIONAL_FIELDS) {
      item[f] = map[f] !== undefined ? String(row[map[f]] ?? '').trim() : '';
    }
    if (!item.item_code) item.errors.push('Missing Item Code');
    if (!item.item_description) item.errors.push('Missing Item Description');
    if (!item.short_description) item.errors.push('Missing Short Description');
    if (item.item_code) {
      const key = item.item_code.toLowerCase();
      if (seen.has(key)) {
        item.errors.push(`Duplicate Item Code (also on row ${seen.get(key)})`);
      } else {
        seen.set(key, item.row);
      }
    }
    item.valid = item.errors.length === 0;
    return item;
  });
  return { missingColumns, items };
}

async function buildTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Products');
  ws.columns = [
    { header: 'Item Code', key: 'item_code', width: 20 },
    { header: 'Item Description', key: 'item_description', width: 45 },
    { header: 'Short Description', key: 'short_description', width: 60 },
    { header: 'Packaging', key: 'packaging', width: 22 },
    { header: 'SRP', key: 'srp', width: 14 },
    { header: 'Discount (%)', key: 'discount', width: 14 },
    { header: 'Trade Price W/ VAT (PHP)', key: 'trade_price', width: 26 },
    { header: 'Price 3', key: 'price3', width: 14 },
    { header: 'UoM Group Name', key: 'uom_group_name', width: 20 },
    { header: 'Retail Price', key: 'retail_price', width: 14 },
  ];
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8102E' } };
  header.height = 22;
  header.alignment = { vertical: 'middle' };
  ws.addRow({ item_code: 'ABC-123', item_description: 'Example Item Name', short_description: 'Example short description shown in the memo.', packaging: 'Box of 60 tablets', srp: '500.00', discount: '10', trade_price: '450.00', price3: '475.00', uom_group_name: 'BOX', retail_price: '500.00' });
  ws.addRow({ item_code: 'DEF-456', item_description: 'Another Example Item', short_description: 'Replace these example rows with your products.', packaging: 'Bottle of 120 mL', srp: '325.50', discount: '5', trade_price: '309.23', price3: '318.00', uom_group_name: 'BOTTLE', retail_price: '325.50' });
  ws.getRow(2).font = { italic: true, color: { argb: 'FF888888' } };
  ws.getRow(3).font = { italic: true, color: { argb: 'FF888888' } };

  const info = wb.addWorksheet('Instructions');
  info.getColumn(1).width = 110;
  [
    'NEW PRODUCT CASCADING SYSTEM - BULK IMPORT TEMPLATE',
    '',
    '1. Fill products in the "Products" sheet (the first sheet is the one imported).',
    '2. Required columns: Item Code, Item Description, Short Description.',
    '   Optional columns: Packaging, SRP, Discount (%), Trade Price W/ VAT (PHP),',
    '   Price 3, UoM Group Name, Retail Price.',
    '   Values are imported exactly as entered — no prices are auto-calculated.',
    '   Sales Team memo shows: Packaging, SRP, Discount (%), Trade Price W/ VAT (PHP), Price 3.',
    '   Stores memo shows: Packaging, UoM Group Name, Retail Price.',
    '   Our Valued Customers memo shows: Packaging, UoM Group Name, Price 3.',
    '3. Item Code must be unique within the file and within the announcement.',
    '4. Delete the example rows before importing, or they will be imported as products.',
    '5. Save as .xlsx or export as .csv, then use "Bulk Import" in the announcement form.',
    '6. Product images are uploaded separately and matched automatically by Item Code',
    '   (name each image file exactly as the Item Code, e.g. ABC-123.jpg).',
  ].forEach((line) => info.addRow([line]));
  info.getRow(1).font = { bold: true, color: { argb: 'FFC8102E' }, size: 13 };

  return wb.xlsx.writeBuffer();
}

module.exports = { parseSpreadsheet, validateRows, buildTemplate, HEADER_ALIASES };