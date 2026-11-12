/* New Product Cascading System - admin SPA */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body instanceof FormData ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { location.replace('/login'); throw new Error('Session expired. Please sign in again.'); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toast').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function openModal(html, wide = false) {
  $('#modal-root').innerHTML = `
    <div class="modal-overlay">
      <div class="modal${wide ? ' wide' : ''}">${html}</div>
    </div>`;
  const overlay = $('.modal-overlay');
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeModal(); });
  return $('.modal');
}
function closeModal() { $('#modal-root').innerHTML = ''; }

function confirmDialog(title, message, onYes, yesLabel = 'Delete') {
  const m = openModal(`
    <div class="modal-head"><h3>${esc(title)}</h3><button class="modal-close" data-close>&times;</button></div>
    <div class="modal-body"><p>${esc(message)}</p></div>
    <div class="modal-foot">
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" data-yes>${esc(yesLabel)}</button>
    </div>`);
  $$('[data-close]', m).forEach((b) => b.addEventListener('click', closeModal));
  $('[data-yes]', m).addEventListener('click', async () => { closeModal(); await onYes(); });
}

const badge = (status) => status === 'sent'
  ? '<span class="badge badge-sent">Cascaded</span>'
  : '<span class="badge badge-draft">Draft</span>';

function fmtDate(s) { return s ? String(s).slice(0, 10) : '—'; }
function fmtDateTime(s) { return s ? String(s).replace('T', ' ').slice(0, 16) + ' UTC' : '—'; }

/* ---------------- Router ---------------- */
const listState = { page: 1, search: '' };
const prodState = { page: 1, search: '' };
let editor = null;

function route() {
  const hash = location.hash || '#/announcements';
  const parts = hash.replace(/^#\//, '').split('/');
  const page = parts[0] || 'announcements';
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === page || (page === 'edit' && a.dataset.route === 'new') || (page === 'announcement' && a.dataset.route === 'announcements')));
  if (page === 'new') renderEditor(null);
  else if (page === 'edit') renderEditor(parts[1]);
  else if (page === 'announcement') renderDetail(parts[1]);
  else if (page === 'stores') renderStores();
  else if (page === 'products') renderProductRecords();
  else renderAnnouncements();
}
window.addEventListener('hashchange', route);

/* ---------------- Announcements list ---------------- */
async function renderAnnouncements() {
  const app = $('#app');
  app.innerHTML = `
    <section class="hero">
      <div class="hero-copy">
        <div class="hero-eyebrow">MAJESTY PHARMA · GMPI</div>
        <h2>WELCOME TO MAJESTY PHARMA!</h2>
        <div class="hero-sub">New Product Cascading &amp; Announcement Management System</div>
        <p>Your central hub for new product announcements, pricing updates, and product cascading.</p>
        <div class="hero-stats">
          <div class="hero-stat"><b id="hero-stat-ann">&mdash;</b><span>Total Announcements</span></div>
          <div class="hero-stat"><b id="hero-stat-prod">&mdash;</b><span>Product Records</span></div>
          <div class="hero-stat"><b id="hero-stat-store">&mdash;</b><span>Stores</span></div>
        </div>
      </div>
      <div class="hero-mascot" aria-hidden="true">
        <div class="mascot-stage">
          <div class="mascot-shadow"></div>
          <div class="mascot-glance">
            <div class="mascot-breathe">
              <img class="mascot-frame mascot-idle" src="/assets/mascot-idle.webp" alt="" fetchpriority="high" decoding="async">
              <img class="mascot-frame mascot-blink" src="/assets/mascot-blink.webp" alt="" loading="lazy" decoding="async">
              <img class="mascot-frame mascot-wave" src="/assets/mascot-wave.webp" alt="" loading="lazy" decoding="async">
            </div>
          </div>
        </div>
        <span class="hero-particle p1"></span><span class="hero-particle p2"></span><span class="hero-particle p3"></span>
        <span class="hero-particle p4"></span><span class="hero-particle p5"></span><span class="hero-particle p6"></span>
      </div>
      <div class="hero-waves" aria-hidden="true">
        <svg class="wave-back" viewBox="0 0 2400 120" preserveAspectRatio="none"><path fill="rgba(214,180,106,.14)" d="M0,64 C200,24 400,104 600,64 C800,24 1000,104 1200,64 C1400,24 1600,104 1800,64 C2000,24 2200,104 2400,64 L2400,120 L0,120 Z"/></svg>
        <svg viewBox="0 0 2400 120" preserveAspectRatio="none"><path fill="rgba(23,20,25,.38)" d="M0,74 C200,40 400,108 600,74 C800,40 1000,108 1200,74 C1400,40 1600,108 1800,74 C2000,40 2200,108 2400,74 L2400,120 L0,120 Z"/></svg>
      </div>
    </section>
    <div class="page-head">
      <div><h2>Announcements</h2><div class="sub">Announcement history and cascading status</div></div>
      <a class="btn btn-primary" href="#/new">&#10133; New Announcement</a>
    </div>
    <div class="card">
      <div class="toolbar">
        <input class="search-input" id="ann-search" placeholder="Search title or memo no..." value="${esc(listState.search)}">
        <button class="btn btn-ghost" id="ann-search-btn">Search</button>
      </div>
      <div id="ann-table"><div class="empty">Loading...</div></div>
      <div class="pagination" id="ann-pager"></div>
    </div>`;
  const doSearch = () => { listState.search = $('#ann-search').value.trim(); listState.page = 1; loadAnnouncements(); };
  $('#ann-search-btn').addEventListener('click', doSearch);
  $('#ann-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  api('/api/products?page=1&limit=1').then((d) => { const el = $('#hero-stat-prod'); if (el) el.textContent = d.total; }).catch(() => {});
  api('/api/stores').then((s) => { const el = $('#hero-stat-store'); if (el) el.textContent = s.length; }).catch(() => {});
  await loadAnnouncements();
}

async function loadAnnouncements() {
  try {
    const data = await api(`/api/announcements?page=${listState.page}&limit=20&search=${encodeURIComponent(listState.search)}`);
    const wrap = $('#ann-table');
    if (!data.items.length) {
      wrap.innerHTML = '<div class="empty"><div class="big">No announcements yet</div>Create your first multi-product announcement.</div>';
    } else {
      wrap.innerHTML = `<table><thead><tr>
        <th>Title / Memo No.</th><th>Products</th><th>Status</th><th>Acknowledged</th><th>Created</th><th style="width:190px">Actions</th>
      </tr></thead><tbody>${data.items.map((a) => {
        const pct = a.target_count ? Math.round((a.ack_count / a.target_count) * 100) : 0;
        return `<tr>
          <td><a href="#/announcement/${a.id}"><b>${esc(a.title)}</b></a><div class="muted">${esc(a.memo_no || 'No memo no.')}</div></td>
          <td>${a.product_count}</td>
          <td>${badge(a.status)}</td>
          <td>${a.target_count ? `<div class="progress${pct === 100 ? ' ok' : ''}"><div style="width:${pct}%"></div></div><div class="muted">${a.ack_count}/${a.target_count} stores</div>` : '<span class="muted">Not cascaded</span>'}</td>
          <td class="muted">${fmtDate(a.created_at)}</td>
          <td><div class="row-actions">
            <a class="btn btn-ghost btn-sm" href="#/announcement/${a.id}">Open</a>
            <a class="btn btn-ghost btn-sm" href="/api/announcements/${a.id}/pdf">PDF</a>
            <button class="btn btn-danger btn-sm" data-del-ann="${a.id}" data-title="${esc(a.title)}">Delete</button>
          </div></td>
        </tr>`;
      }).join('')}</tbody></table>`;
      $$('[data-del-ann]', wrap).forEach((b) => b.addEventListener('click', () => {
        confirmDialog('Delete Announcement', `Delete "${b.dataset.title}" and all its product records? This cannot be undone.`, async () => {
          try { await api(`/api/announcements/${b.dataset.delAnn}`, { method: 'DELETE' }); toast('Announcement deleted.', 'success'); loadAnnouncements(); }
          catch (e) { toast(e.message, 'error'); }
        });
      }));
    }
    const pages = Math.max(1, Math.ceil(data.total / data.limit));
    const heroAnn = $('#hero-stat-ann');
    if (heroAnn) heroAnn.textContent = data.total;
    $('#ann-pager').innerHTML = `${data.total} announcement(s) &nbsp;·&nbsp; Page ${data.page} of ${pages}
      <button class="btn btn-ghost btn-sm" id="pg-prev" ${data.page <= 1 ? 'disabled' : ''}>&larr;</button>
      <button class="btn btn-ghost btn-sm" id="pg-next" ${data.page >= pages ? 'disabled' : ''}>&rarr;</button>`;
    $('#pg-prev')?.addEventListener('click', () => { listState.page--; loadAnnouncements(); });
    $('#pg-next')?.addEventListener('click', () => { listState.page++; loadAnnouncements(); });
  } catch (e) { $('#ann-table').innerHTML = `<div class="empty error-text">${esc(e.message)}</div>`; }
}

/* ---------------- Editor (create / edit) ---------------- */
async function renderEditor(id) {
  editor = { id: id || null, products: [], _key: 0 };
  if (id) {
    try {
      const a = await api(`/api/announcements/${id}`);
      editor.products = a.products.map((p) => ({ ...p, _k: ++editor._key }));
      editor.loaded = a;
    } catch (e) { toast(e.message, 'error'); location.hash = '#/announcements'; return; }
  }
  const a = editor.loaded || {};
  $('#app').innerHTML = `
    <div class="page-head">
      <div><h2>${id ? 'Edit Announcement' : 'New Announcement'}</h2><div class="sub">One announcement · unlimited products · one link for all stores</div></div>
      <div class="btn-row">
        <a class="btn btn-ghost" href="${id ? `#/announcement/${id}` : '#/announcements'}">Cancel</a>
        <button class="btn btn-primary" id="save-ann">&#128190; Save Announcement</button>
      </div>
    </div>

    <div class="card">
      <h3>Announcement Details</h3>
      <div class="field"><label>Title <span class="req">*</span></label><input id="f-title" value="${esc(a.title || '')}" placeholder="e.g. New Products – November 2026 Wave 1"></div>
      <div class="form-grid">
        <div class="field"><label>Memo No.</label><input id="f-memo" value="${esc(a.memo_no || '')}" placeholder="e.g. MEMO-2026-041"></div>
        <div class="field"><label>Effective Date</label><input id="f-date" type="date" value="${esc(a.effective_date || '')}"></div>
      </div>
      <div class="form-grid routing-grid">
        <div class="field"><label>To</label><input id="f-to" list="recipient-options" value="${esc(a.to_recipient || '')}" placeholder="Select or type a recipient">
          <datalist id="recipient-options">
            <option value="SALES TEAM"></option>
            <option value="STORES"></option>
            <option value="OUR VALUED CUSTOMERS"></option>
          </datalist>
        </div>
        <div class="field"><label>From</label><input id="f-from" value="${esc(a.from_sender || 'Grand Majesty Pharmaceutical Inc.')}" placeholder="Grand Majesty Pharmaceutical Inc."></div>
      </div>
      <div class="form-grid">
        <div class="field"><label>Prepared By</label><input id="f-prepared" value="${esc(a.prepared_by || '')}" placeholder="Name / Department"></div>
        <div class="field"><label>Approved By</label><input id="f-approved" value="${esc(a.approved_by || '')}" placeholder="Name / Department"></div>
      </div>
      <div class="field"><label>Introduction / Instructions</label><textarea id="f-intro" placeholder="Optional message shown at the top of the memo...">${esc(a.intro || '')}</textarea></div>
    </div>

    <div class="card">
      <h3>Products <span class="count" id="prod-count"></span></h3>
      <div class="toolbar">
        <button class="btn btn-primary" id="add-product">&#10133; Add Product</button>
        <button class="btn btn-outline" id="bulk-import">&#128229; Bulk Import (Excel / CSV)</button>
        <a class="btn btn-ghost" href="/api/import/template">&#128196; Download Template</a>
        <button class="btn btn-ghost" id="match-images">&#128247; Upload Images by Item Code</button>
        <div class="spacer"></div>
        <span class="muted">Drag rows or use arrows to reorder</span>
      </div>
      <input type="file" id="import-file" accept=".xlsx,.csv" class="hidden">
      <input type="file" id="images-file" accept="image/*" multiple class="hidden">
      <div id="product-list"></div>
    </div>

    <div class="btn-row" style="justify-content:flex-end">
      <button class="btn btn-primary" id="save-ann-2">&#128190; Save Announcement</button>
    </div>`;

  $('#add-product').addEventListener('click', () => productModal(null));
  $('#bulk-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', handleImportFile);
  $('#match-images').addEventListener('click', () => $('#images-file').click());
  $('#images-file').addEventListener('change', handleImagesByCode);
  $('#save-ann').addEventListener('click', saveAnnouncement);
  $('#save-ann-2').addEventListener('click', saveAnnouncement);
  renderProductList();
}

function renderProductList() {
  const wrap = $('#product-list');
  $('#prod-count').textContent = `(${editor.products.length})`;
  if (!editor.products.length) {
    wrap.innerHTML = '<div class="empty"><div class="big">No products yet</div>Add products one by one, or bulk import from Excel / CSV.</div>';
    return;
  }
  wrap.innerHTML = editor.products.map((p, i) => `
    <div class="product-row" draggable="true" data-idx="${i}">
      <span class="num">${String(i + 1).padStart(3, '0')}</span>
      ${p.image_path ? `<img class="thumb" src="${esc(p.image_path)}" alt="">` : '<div class="thumb placeholder">No image</div>'}
      <div class="info">
        <div class="code">${esc(p.item_code)}</div>
        <div class="desc">${esc(p.item_description)}</div>
        ${p.principal || p.item_category ? `<div class="short" style="color:var(--gold-soft)">${[p.principal, p.item_category].filter(Boolean).map(esc).join(' · ')}</div>` : ''}
        <div class="short">${esc(p.short_description)}</div>
        ${pricingSummary(p) ? `<div class="short" style="color:var(--gold-soft)">${pricingSummary(p)}</div>` : ''}
      </div>
      <div class="row-actions">
        <button class="icon-btn" data-move="-1" ${i === 0 ? 'disabled' : ''} title="Move up">&#9650;</button>
        <button class="icon-btn" data-move="1" ${i === editor.products.length - 1 ? 'disabled' : ''} title="Move down">&#9660;</button>
        <button class="icon-btn" data-edit title="Edit">&#9998;</button>
        <button class="icon-btn" data-del title="Remove">&#128465;</button>
      </div>
    </div>`).join('');

  $$('.product-row', wrap).forEach((row) => {
    const idx = Number(row.dataset.idx);
    $('[data-edit]', row).addEventListener('click', () => productModal(idx));
    $('[data-del]', row).addEventListener('click', () => { editor.products.splice(idx, 1); renderProductList(); });
    $$('[data-move]', row).forEach((b) => b.addEventListener('click', () => {
      const to = idx + Number(b.dataset.move);
      [editor.products[idx], editor.products[to]] = [editor.products[to], editor.products[idx]];
      renderProductList();
    }));
    row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', idx); row.classList.add('dragging'); });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (e) => e.preventDefault());
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = Number(e.dataTransfer.getData('text/plain'));
      if (Number.isNaN(from) || from === idx) return;
      const [moved] = editor.products.splice(from, 1);
      editor.products.splice(idx, 0, moved);
      renderProductList();
    });
  });
}

function pricingSummary(p) {
  const parts = [];
  if (p.packaging) parts.push(`Pack: ${esc(p.packaging)}`);
  if (p.srp) parts.push(`SRP: ${esc(p.srp)}`);
  if (p.discount) parts.push(`Disc: ${esc(p.discount)}%`);
  if (p.trade_price) parts.push(`Trade: ${esc(p.trade_price)}`);
  if (p.price3) parts.push(`P3: ${esc(p.price3)}`);
  if (p.uom_group_name) parts.push(`UoM: ${esc(p.uom_group_name)}`);
  if (p.retail_price) parts.push(`Retail: ${esc(p.retail_price)}`);
  return parts.join(' · ');
}

function productModal(idx) {
  const p = idx !== null ? editor.products[idx] : { principal: '', item_category: '', item_code: '', item_description: '', short_description: '', image_path: null, packaging: '', srp: '', discount: '', trade_price: '', price3: '', uom_group_name: '', retail_price: '' };
  const m = openModal(`
    <div class="modal-head"><h3>${idx !== null ? 'Edit Product' : 'Add Product'}</h3><button class="modal-close" data-close>&times;</button></div>
    <div class="modal-body">
      <div class="form-grid">
        <div class="field"><label>Principal</label><input id="p-principal" value="${esc(p.principal || '')}" placeholder="e.g. Unilab"></div>
        <div class="field"><label>Item Category</label><input id="p-category" value="${esc(p.item_category || '')}" placeholder="e.g. Vitamins & Supplements"></div>
      </div>
      <div class="field"><label>Item Code <span class="req">*</span></label><input id="p-code" value="${esc(p.item_code)}" placeholder="e.g. ABC-123"></div>
      <div class="field"><label>Item Description <span class="req">*</span></label><input id="p-desc" value="${esc(p.item_description)}" placeholder="Official item name / description"></div>
      <div class="field"><label>Short Description <span class="req">*</span></label><textarea id="p-short" placeholder="Brief selling point or details shown in the memo">${esc(p.short_description)}</textarea></div>
      <div class="form-grid">
        <div class="field"><label>Packaging</label><input id="p-packaging" value="${esc(p.packaging || '')}" placeholder="e.g. Box of 60 tablets"></div>
        <div class="field"><label>SRP</label><input id="p-srp" inputmode="decimal" value="${esc(p.srp || '')}" placeholder="e.g. 500.00"></div>
        <div class="field"><label>Discount (%)</label><input id="p-discount" inputmode="decimal" value="${esc(p.discount || '')}" placeholder="e.g. 10"></div>
        <div class="field"><label>Trade Price W/ VAT (PHP)</label><input id="p-trade" inputmode="decimal" value="${esc(p.trade_price || '')}" placeholder="e.g. 450.00"></div>
        <div class="field"><label>Price 3</label><input id="p-price3" inputmode="decimal" value="${esc(p.price3 || '')}" placeholder="e.g. 475.00"></div>
        <div class="field"><label>UoM Group Name</label><input id="p-uom" value="${esc(p.uom_group_name || '')}" placeholder="e.g. BOX"></div>
        <div class="field"><label>Retail Price</label><input id="p-retail" inputmode="decimal" value="${esc(p.retail_price || '')}" placeholder="e.g. 500.00"></div>
      </div>
      <div class="field"><label>Product Image</label>
        <div class="btn-row">
          <div id="p-img-wrap">${p.image_path ? `<img class="img-preview" src="${esc(p.image_path)}">` : '<div class="thumb placeholder" style="width:120px;height:120px">No image</div>'}</div>
          <div>
            <input type="file" id="p-img-file" accept="image/*" class="hidden">
            <button class="btn btn-outline btn-sm" id="p-img-btn">Upload Image</button>
            <button class="btn btn-ghost btn-sm ${p.image_path ? '' : 'hidden'}" id="p-img-remove">Remove</button>
            <div class="muted" style="margin-top:6px">JPG, PNG, WEBP or GIF · max 10 MB</div>
          </div>
        </div>
      </div>
      <div class="error-text" id="p-error"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" id="p-save">${idx !== null ? 'Update Product' : 'Add Product'}</button>
    </div>`);

  let imagePath = p.image_path;
  $$('[data-close]', m).forEach((b) => b.addEventListener('click', closeModal));
  $('#p-img-btn', m).addEventListener('click', () => $('#p-img-file', m).click());
  $('#p-img-file', m).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('images', file);
    fd.append('itemCode', $('#p-code', m).value.trim() || file.name);
    try {
      const r = await api('/api/upload/images', { method: 'POST', body: fd });
      imagePath = r.files[0].url;
      $('#p-img-wrap', m).innerHTML = `<img class="img-preview" src="${esc(imagePath)}">`;
      $('#p-img-remove', m).classList.remove('hidden');
    } catch (err) { toast(err.message, 'error'); }
    e.target.value = '';
  });
  $('#p-img-remove', m).addEventListener('click', () => {
    imagePath = null;
    $('#p-img-wrap', m).innerHTML = '<div class="thumb placeholder" style="width:120px;height:120px">No image</div>';
    $('#p-img-remove', m).classList.add('hidden');
  });
  $('#p-save', m).addEventListener('click', () => {
    const code = $('#p-code', m).value.trim();
    const desc = $('#p-desc', m).value.trim();
    const short = $('#p-short', m).value.trim();
    const errEl = $('#p-error', m);
    if (!code || !desc || !short) { errEl.textContent = 'Item Code, Item Description and Short Description are all required.'; return; }
    const dup = editor.products.some((x, i) => i !== idx && x.item_code.toLowerCase() === code.toLowerCase());
    if (dup) { errEl.textContent = `Item Code "${code}" is already in this announcement.`; return; }
    const entry = {
      principal: $('#p-principal', m).value.trim(),
      item_category: $('#p-category', m).value.trim(),
      item_code: code, item_description: desc, short_description: short, image_path: imagePath,
      packaging: $('#p-packaging', m).value.trim(),
      srp: $('#p-srp', m).value.trim(),
      discount: $('#p-discount', m).value.trim(),
      trade_price: $('#p-trade', m).value.trim(),
      price3: $('#p-price3', m).value.trim(),
      uom_group_name: $('#p-uom', m).value.trim(),
      retail_price: $('#p-retail', m).value.trim(),
      _k: p._k || ++editor._key,
    };
    if (idx !== null) editor.products[idx] = entry; else editor.products.push(entry);
    closeModal();
    renderProductList();
  });
}

/* ---------------- Bulk import ---------------- */
async function handleImportFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  let result;
  try { result = await api('/api/import', { method: 'POST', body: fd }); }
  catch (err) { toast(err.message, 'error'); return; }
  if (!result.total) { toast('The file contains no product rows.', 'error'); return; }

  const existing = new Set(editor.products.map((p) => p.item_code.toLowerCase()));
  result.items.forEach((it) => {
    if (it.valid && existing.has(it.item_code.toLowerCase())) {
      it.valid = false;
      it.errors.push('Already in this announcement');
    }
  });
  const addable = result.items.filter((i) => i.valid).length;

  const m = openModal(`
    <div class="modal-head"><h3>Review Import — ${esc(result.filename)}</h3><button class="modal-close" data-close>&times;</button></div>
    <div class="modal-body">
      ${result.missingColumns.length ? `<div class="ack-banner" style="background:var(--danger-bg);color:var(--danger)">Missing required column(s): ${result.missingColumns.map(esc).join(', ')}. Use the downloadable template.</div>` : ''}
      <div class="import-summary">
        <div class="stat"><b>${result.total}</b>Rows found</div>
        <div class="stat"><b style="color:var(--success)">${addable}</b>Ready to add</div>
        <div class="stat"><b style="color:var(--danger)">${result.total - addable}</b>With errors</div>
      </div>
      <p class="muted" style="margin-bottom:10px">Only checked rows will be added. Fix error rows in your file and re-import, or add them manually. Images can be matched afterwards via "Upload Images by Item Code".</p>
      <div class="import-table-wrap">
        <table><thead><tr><th style="width:34px"><input type="checkbox" id="imp-all" checked></th><th>Row</th><th>Item Code</th><th>Item Description</th><th>Short Description</th><th>Packaging / Pricing</th><th>Status</th></tr></thead>
        <tbody>${result.items.map((it, i) => `
          <tr class="${it.valid ? '' : 'row-invalid'}">
            <td><input type="checkbox" class="imp-check" data-i="${i}" ${it.valid ? 'checked' : 'disabled'}></td>
            <td class="muted">${it.row}</td>
            <td><b>${esc(it.item_code)}</b></td>
            <td>${esc(it.item_description)}</td>
            <td>${esc(it.short_description)}</td>
            <td class="muted" style="font-size:11.5px;white-space:nowrap">${pricingSummary(it) || '—'}</td>
            <td>${it.valid ? '<span class="badge badge-ok">Valid</span>' : `<span class="error-text">${esc(it.errors.join('; '))}</span>`}</td>
          </tr>`).join('')}</tbody></table>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" id="imp-add" ${addable === 0 ? 'disabled' : ''}>Add Selected (<span id="imp-n">${addable}</span>)</button>
    </div>`, true);

  $$('[data-close]', m).forEach((b) => b.addEventListener('click', closeModal));
  const updateCount = () => {
    const n = $$('.imp-check:checked', m).length;
    $('#imp-n', m).textContent = n;
    $('#imp-add', m).disabled = n === 0;
  };
  $('#imp-all', m).addEventListener('change', (e) => { $$('.imp-check:not(:disabled)', m).forEach((c) => c.checked = e.target.checked); updateCount(); });
  $$('.imp-check', m).forEach((c) => c.addEventListener('change', updateCount));
  $('#imp-add', m).addEventListener('click', () => {
    const selected = $$('.imp-check:checked', m).map((c) => result.items[Number(c.dataset.i)]);
    for (const it of selected) {
      editor.products.push({ item_code: it.item_code, item_description: it.item_description, short_description: it.short_description, image_path: null, packaging: it.packaging || '', srp: it.srp || '', discount: it.discount || '', trade_price: it.trade_price || '', price3: it.price3 || '', uom_group_name: it.uom_group_name || '', retail_price: it.retail_price || '', _k: ++editor._key });
    }
    closeModal();
    renderProductList();
    toast(`${selected.length} product(s) added from ${result.filename}. Review and save the announcement.`, 'success');
  });
}

/* ---------------- Images matched by Item Code ---------------- */
async function handleImagesByCode(e) {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  if (!editor.products.length) { toast('Add products first, then upload images to match by Item Code.', 'error'); return; }
  const fd = new FormData();
  files.forEach((f) => fd.append('images', f));
  let result;
  try { result = await api('/api/upload/images', { method: 'POST', body: fd }); }
  catch (err) { toast(err.message, 'error'); return; }

  const byCode = new Map(editor.products.map((p) => [p.item_code.toLowerCase(), p]));
  const matched = [], unmatched = [];
  for (const f of result.files) {
    const p = byCode.get(f.itemCode.toLowerCase());
    if (p) { p.image_path = f.url; matched.push(f); } else unmatched.push(f);
  }
  renderProductList();
  const m = openModal(`
    <div class="modal-head"><h3>Image Matching Results</h3><button class="modal-close" data-close>&times;</button></div>
    <div class="modal-body">
      <div class="import-summary">
        <div class="stat"><b style="color:var(--success)">${matched.length}</b>Matched</div>
        <div class="stat"><b style="color:var(--danger)">${unmatched.length}</b>Unmatched</div>
      </div>
      ${unmatched.length ? `<p class="muted" style="margin-bottom:8px">These files did not match any Item Code in this announcement. Rename the file to the exact Item Code (e.g. <b>ABC-123.jpg</b>) and upload again:</p>
      <ul style="margin-left:18px">${unmatched.map((f) => `<li>${esc(f.originalName)} <span class="muted">(looked for Item Code "${esc(f.itemCode)}")</span></li>`).join('')}</ul>` : '<p>All images matched. Save the announcement to keep them.</p>'}
    </div>
    <div class="modal-foot"><button class="btn btn-primary" data-close>Done</button></div>`);
  $$('[data-close]', m).forEach((b) => b.addEventListener('click', closeModal));
}

/* ---------------- Save ---------------- */
async function saveAnnouncement() {
  const body = {
    title: $('#f-title').value.trim(),
    memo_no: $('#f-memo').value.trim(),
    effective_date: $('#f-date').value,
    prepared_by: $('#f-prepared').value.trim(),
    approved_by: $('#f-approved').value.trim(),
    to_recipient: $('#f-to').value.trim(),
    from_sender: $('#f-from').value.trim(),
    intro: $('#f-intro').value.trim(),
    products: editor.products.map(({ principal, item_category, item_code, item_description, short_description, image_path, packaging, srp, discount, trade_price, price3, uom_group_name, retail_price }) => ({ principal, item_category, item_code, item_description, short_description, image_path, packaging, srp, discount, trade_price, price3, uom_group_name, retail_price })),
  };
  if (!body.title) { toast('Announcement title is required.', 'error'); $('#f-title').focus(); return; }
  if (!body.products.length) { toast('Add at least one product.', 'error'); return; }
  try {
    if (editor.id) {
      await api(`/api/announcements/${editor.id}`, { method: 'PUT', body });
      toast('Announcement updated.', 'success');
      location.hash = `#/announcement/${editor.id}`;
    } else {
      const r = await api('/api/announcements', { method: 'POST', body });
      toast('Announcement saved.', 'success');
      location.hash = `#/announcement/${r.id}`;
    }
  } catch (e) { toast(e.message, 'error'); }
}

/* ---------------- Detail / cascading ---------------- */
async function renderDetail(id) {
  let a;
  try { a = await api(`/api/announcements/${id}`); }
  catch (e) { toast(e.message, 'error'); location.hash = '#/announcements'; return; }
  const stores = await api('/api/stores').catch(() => []);
  const targeted = new Set(a.targets.map((t) => t.store_id));
  const acked = a.targets.filter((t) => t.acknowledged_at).length;
  const pct = a.targets.length ? Math.round((acked / a.targets.length) * 100) : 0;

  $('#app').innerHTML = `
    <div class="page-head">
      <div><h2>${esc(a.title)} ${badge(a.status)}</h2><div class="sub">Created ${fmtDateTime(a.created_at)} · Updated ${fmtDateTime(a.updated_at)}</div></div>
      <div class="btn-row">
        <a class="btn btn-ghost" href="#/announcements">&larr; History</a>
        <a class="btn btn-outline" href="#/edit/${a.id}">&#9998; Edit</a>
        <button class="btn btn-danger" id="del-ann">Delete</button>
      </div>
    </div>

    <div class="card">
      <div class="meta-grid">
        <div class="meta"><span>Memo No.</span><b>${esc(a.memo_no || '—')}</b></div>
        <div class="meta"><span>Effective Date</span><b>${esc(a.effective_date || '—')}</b></div>
        <div class="meta"><span>To</span><b>${esc(a.to_recipient || '—')}</b></div>
        <div class="meta"><span>From</span><b>${esc(a.from_sender || '—')}</b></div>
        <div class="meta"><span>Prepared By</span><b>${esc(a.prepared_by || '—')}</b></div>
        <div class="meta"><span>Approved By</span><b>${esc(a.approved_by || '—')}</b></div>
        <div class="meta"><span>Products</span><b>${a.products.length}</b></div>
      </div>
      ${a.intro ? `<p style="white-space:pre-wrap">${esc(a.intro)}</p>` : ''}
    </div>

    <div class="card">
      <h3>Memo PDF Downloads</h3>
      <p class="muted" style="margin-bottom:12px">One memo design, three recipient versions — same products, images, and layout; only the pricing columns differ.</p>
      <div class="btn-row" style="flex-wrap:wrap">
        <a class="btn btn-primary" href="/api/announcements/${a.id}/pdf?recipient=sales">&#128196; Sales Team Memo</a>
        <a class="btn btn-outline" href="/api/announcements/${a.id}/pdf?recipient=stores">&#128196; Stores Memo</a>
        <a class="btn btn-outline" href="/api/announcements/${a.id}/pdf?recipient=customers">&#128196; Our Valued Customers Memo</a>
        <a class="btn btn-ghost" href="/api/announcements/${a.id}/pdf-all">&#128230; Download All Three (ZIP)</a>
      </div>
      <div class="muted" style="margin-top:10px;font-size:11.5px">
        Sales Team: Packaging · SRP · Discount (%) · Trade Price W/ VAT (PHP) · Price 3<br>
        Stores: Packaging · UoM Group Name · Retail Price &nbsp;|&nbsp; Valued Customers: Packaging · UoM Group Name · Price 3
      </div>
    </div>

    <div class="card">
      <h3>Cascading &amp; Acknowledgment</h3>
      ${a.status === 'sent' ? `
        <div class="field"><label>Announcement Link (one link for all products)</label>
          <div class="link-box"><code id="pub-link">${esc(a.public_url)}</code><button class="btn btn-outline btn-sm" id="copy-link">Copy</button><a class="btn btn-ghost btn-sm" href="${esc(a.public_url)}" target="_blank">Open</a></div>
        </div>
        <div class="toolbar">
          <div class="progress${pct === 100 ? ' ok' : ''}" style="flex:1;max-width:340px"><div style="width:${pct}%"></div></div>
          <b>${acked} / ${a.targets.length}</b><span class="muted">stores acknowledged</span>
          <div class="spacer"></div>
          <button class="btn btn-ghost btn-sm" id="refresh-acks">&#8635; Refresh</button>
        </div>
        <table><thead><tr><th>Store</th><th>Code</th><th>Status</th><th>Acknowledged By</th><th>Date (UTC)</th></tr></thead>
        <tbody>${a.targets.map((t) => `<tr>
          <td><b>${esc(t.store_name)}</b></td><td>${esc(t.store_code || '—')}</td>
          <td>${t.acknowledged_at ? '<span class="badge badge-ok">Acknowledged</span>' : '<span class="badge badge-pending">Pending</span>'}</td>
          <td>${esc(t.acknowledged_by || '—')}</td><td class="muted">${fmtDateTime(t.acknowledged_at)}</td>
        </tr>`).join('')}</tbody></table>
        <details style="margin-top:14px"><summary class="muted" style="cursor:pointer">Cascade to additional stores</summary>
          <div style="margin-top:10px">${cascadePicker(stores, targeted)}</div>
        </details>
      ` : `
        <p class="muted" style="margin-bottom:12px">Choose which stores will receive this announcement. All stores share one announcement link.</p>
        ${cascadePicker(stores, targeted)}
      `}
    </div>

    <div class="card">
      <h3>Products <span class="count">(${a.products.length})</span></h3>
      <div class="product-grid">${a.products.map(productCard).join('')}</div>
    </div>`;

  $('#del-ann').addEventListener('click', () => confirmDialog('Delete Announcement', `Delete "${a.title}" and all its product records?`, async () => {
    try { await api(`/api/announcements/${a.id}`, { method: 'DELETE' }); toast('Announcement deleted.', 'success'); location.hash = '#/announcements'; }
    catch (e) { toast(e.message, 'error'); }
  }));
  $('#refresh-acks')?.addEventListener('click', () => renderDetail(id));
  $('#copy-link')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(a.public_url); toast('Link copied to clipboard.', 'success'); }
    catch { toast('Copy failed — select and copy the link manually.', 'error'); }
  });
  wireCascadePicker(a.id);
}

function pricingGrid(p) {
  if (!p.packaging && !p.srp && !p.discount && !p.trade_price && !p.price3 && !p.uom_group_name && !p.retail_price) return '';
  const cell = (label, value) => `<div><span>${label}</span><b>${esc(value || '—')}</b></div>`;
  return `<div class="price-grid">
    ${cell('Packaging', p.packaging)}${cell('SRP', p.srp)}
    ${cell('Discount (%)', p.discount)}${cell('Trade Price W/ VAT (PHP)', p.trade_price)}
    ${cell('Price 3', p.price3)}${cell('UoM Group Name', p.uom_group_name)}
    ${cell('Retail Price', p.retail_price)}
  </div>`;
}

function productCard(p) {
  return `<div class="product-card">
    ${p.image_path ? `<img src="${esc(p.image_path)}" alt="${esc(p.item_code)}">` : '<div class="no-img">No image</div>'}
    <div style="flex:1;min-width:0"><div class="code">${esc(p.item_code)}</div><div class="desc">${esc(p.item_description)}</div>${p.principal || p.item_category ? `<div class="short" style="color:var(--gold-soft)">${[p.principal, p.item_category].filter(Boolean).map(esc).join(' · ')}</div>` : ''}<div class="short">${esc(p.short_description)}</div>${pricingGrid(p)}</div>
  </div>`;
}

function cascadePicker(stores, targeted) {
  if (!stores.length) return '<div class="empty">No stores registered. <a href="#/stores">Add stores first</a>.</div>';
  return `
    <div class="toolbar" style="margin-bottom:8px">
      <label style="display:flex;gap:8px;align-items:center;font-weight:600"><input type="checkbox" id="cas-all"> All Stores (${stores.length})</label>
    </div>
    <div class="store-picker" id="cas-stores">
      ${stores.map((s) => `<label><input type="checkbox" class="cas-store" value="${s.id}" ${targeted.has(s.id) ? 'disabled checked' : ''}> ${esc(s.name)} ${s.code ? `<span class="muted">(${esc(s.code)})</span>` : ''} ${targeted.has(s.id) ? '<span class="badge badge-sent">Already cascaded</span>' : ''}</label>`).join('')}
    </div>
    <div class="btn-row" style="margin-top:12px">
      <button class="btn btn-primary" id="cas-go">&#128227; Cascade Announcement</button>
      <span class="muted">Recipients get one link covering every product.</span>
    </div>`;
}

function wireCascadePicker(announcementId) {
  const all = $('#cas-all');
  if (!all) return;
  all.addEventListener('change', () => $$('.cas-store:not(:disabled)').forEach((c) => c.checked = all.checked));
  $('#cas-go').addEventListener('click', async () => {
    const storeIds = $$('.cas-store:checked:not(:disabled)').map((c) => Number(c.value));
    const isAll = all.checked;
    if (!isAll && !storeIds.length) { toast('Select at least one store, or choose All Stores.', 'error'); return; }
    try {
      const r = await api(`/api/announcements/${announcementId}/cascade`, { method: 'POST', body: { all: isAll, storeIds } });
      toast('Announcement cascaded. Share the link with stores.', 'success');
      renderDetail(announcementId);
    } catch (e) { toast(e.message, 'error'); }
  });
}

/* ---------------- Stores ---------------- */
async function renderStores() {
  const stores = await api('/api/stores').catch(() => []);
  $('#app').innerHTML = `
    <div class="page-head">
      <div><h2>Stores</h2><div class="sub">Recipients of cascaded announcements</div></div>
      <button class="btn btn-primary" id="add-store">&#10133; Add Store</button>
    </div>
    <div class="card">
      ${stores.length ? `<table><thead><tr><th>Store Name</th><th>Code</th><th>Added</th><th style="width:140px">Actions</th></tr></thead>
      <tbody>${stores.map((s) => `<tr>
        <td><b>${esc(s.name)}</b></td><td>${esc(s.code || '—')}</td><td class="muted">${fmtDate(s.created_at)}</td>
        <td><div class="row-actions">
          <button class="btn btn-ghost btn-sm" data-edit-store="${s.id}">Edit</button>
          <button class="btn btn-danger btn-sm" data-del-store="${s.id}" data-name="${esc(s.name)}">Delete</button>
        </div></td>
      </tr>`).join('')}</tbody></table>` : '<div class="empty"><div class="big">No stores yet</div>Add stores to start cascading announcements.</div>'}
    </div>`;
  $('#add-store').addEventListener('click', () => storeModal(null));
  $$('[data-edit-store]').forEach((b) => b.addEventListener('click', () => storeModal(stores.find((s) => s.id === Number(b.dataset.editStore)))));
  $$('[data-del-store]').forEach((b) => b.addEventListener('click', () => confirmDialog('Delete Store', `Delete store "${b.dataset.name}"? Its acknowledgment records will also be removed.`, async () => {
    try { await api(`/api/stores/${b.dataset.delStore}`, { method: 'DELETE' }); toast('Store deleted.', 'success'); renderStores(); }
    catch (e) { toast(e.message, 'error'); }
  })));
}

function storeModal(store) {
  const m = openModal(`
    <div class="modal-head"><h3>${store ? 'Edit Store' : 'Add Store'}</h3><button class="modal-close" data-close>&times;</button></div>
    <div class="modal-body">
      <div class="field"><label>Store Name <span class="req">*</span></label><input id="s-name" value="${esc(store?.name || '')}" placeholder="e.g. SM North Branch"></div>
      <div class="field"><label>Store Code</label><input id="s-code" value="${esc(store?.code || '')}" placeholder="e.g. STR-001"></div>
      <div class="error-text" id="s-error"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" id="s-save">${store ? 'Update' : 'Add Store'}</button>
    </div>`);
  $$('[data-close]', m).forEach((b) => b.addEventListener('click', closeModal));
  $('#s-save', m).addEventListener('click', async () => {
    const body = { name: $('#s-name', m).value.trim(), code: $('#s-code', m).value.trim() };
    if (!body.name) { $('#s-error', m).textContent = 'Store name is required.'; return; }
    try {
      if (store) await api(`/api/stores/${store.id}`, { method: 'PUT', body });
      else await api('/api/stores', { method: 'POST', body });
      closeModal(); toast('Store saved.', 'success'); renderStores();
    } catch (e) { $('#s-error', m).textContent = e.message; }
  });
}

/* ---------------- Product records ---------------- */
async function renderProductRecords() {
  $('#app').innerHTML = `
    <div class="page-head">
      <div><h2>Product Records</h2><div class="sub">Every product across all announcements</div></div>
    </div>
    <div class="card">
      <div class="toolbar">
        <input class="search-input" id="pr-search" placeholder="Search item code or description..." value="${esc(prodState.search)}">
        <button class="btn btn-ghost" id="pr-search-btn">Search</button>
      </div>
      <div id="pr-table"><div class="empty">Loading...</div></div>
      <div class="pagination" id="pr-pager"></div>
    </div>`;
  const doSearch = () => { prodState.search = $('#pr-search').value.trim(); prodState.page = 1; loadProductRecords(); };
  $('#pr-search-btn').addEventListener('click', doSearch);
  $('#pr-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  await loadProductRecords();
}

async function loadProductRecords() {
  try {
    const data = await api(`/api/products?page=${prodState.page}&limit=25&search=${encodeURIComponent(prodState.search)}`);
    const wrap = $('#pr-table');
    wrap.innerHTML = data.items.length ? `<table><thead><tr>
      <th style="width:64px">Image</th><th>Principal</th><th>Item Category</th><th>Item Code</th><th>Item Description</th><th>Short Description</th><th>Announcement</th><th>Date</th>
    </tr></thead><tbody>${data.items.map((p) => `<tr>
      <td>${p.image_path ? `<img class="thumb" style="width:44px;height:44px;object-fit:cover;border-radius:6px" src="${esc(p.image_path)}">` : '<span class="muted">—</span>'}</td>
      <td>${esc(p.principal || '—')}</td>
      <td>${esc(p.item_category || '—')}</td>
      <td><b style="color:var(--gold)">${esc(p.item_code)}</b></td>
      <td>${esc(p.item_description)}</td>
      <td class="muted">${esc(p.short_description)}</td>
      <td><a href="#/announcement/${p.announcement_id}">${esc(p.announcement_title)}</a></td>
      <td class="muted">${fmtDate(p.announced_at)}</td>
    </tr>`).join('')}</tbody></table>` : '<div class="empty"><div class="big">No product records</div>Products appear here once announcements are saved.</div>';
    const pages = Math.max(1, Math.ceil(data.total / data.limit));
    $('#pr-pager').innerHTML = `${data.total} product(s) &nbsp;·&nbsp; Page ${data.page} of ${pages}
      <button class="btn btn-ghost btn-sm" id="pr-prev" ${data.page <= 1 ? 'disabled' : ''}>&larr;</button>
      <button class="btn btn-ghost btn-sm" id="pr-next" ${data.page >= pages ? 'disabled' : ''}>&rarr;</button>`;
    $('#pr-prev')?.addEventListener('click', () => { prodState.page--; loadProductRecords(); });
    $('#pr-next')?.addEventListener('click', () => { prodState.page++; loadProductRecords(); });
  } catch (e) { $('#pr-table').innerHTML = `<div class="empty error-text">${esc(e.message)}</div>`; }
}

(async () => {
  try {
    const res = await fetch('/api/auth/me');
    if (res.status === 401) { location.replace('/login'); return; }
    const data = await res.json();
    const el = $('#sidebar-username');
    if (el && data.user) el.textContent = data.user.username;
  } catch {}
  $('#logout-btn')?.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.replace('/login');
  });
  route();
})();