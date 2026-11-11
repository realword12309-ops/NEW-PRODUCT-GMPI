/* Store-facing announcement view */
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = location.pathname.split('/').filter(Boolean).pop();

function pricingGrid(p) {
  if (!p.packaging && !p.uom_group_name && !p.retail_price) return '';
  const cell = (label, value) => `<div><span>${label}</span><b>${esc(value || '—')}</b></div>`;
  return `<div class="price-grid">
    ${cell('Packaging', p.packaging)}${cell('UoM Group Name', p.uom_group_name)}
    ${cell('Retail Price', p.retail_price)}
  </div>`;
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toast').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

async function load() {
  let a;
  try {
    const res = await fetch(`/api/public/${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error((await res.json()).error || 'Not found');
    a = await res.json();
  } catch (e) {
    $('#v-title').textContent = 'Announcement unavailable';
    $('#v-body').innerHTML = `<div class="card"><div class="empty"><div class="big">This announcement link is not available</div>${esc(e.message)}</div></div>`;
    return;
  }

  document.title = `${a.title} – Product Announcement`;
  $('#v-title').textContent = a.title;
  const acked = a.stores.filter((s) => s.acknowledged_at).length;

  $('#v-body').innerHTML = `
    <div class="card">
      <div class="meta-grid">
        <div class="meta"><span>Memo No.</span><b>${esc(a.memo_no || '—')}</b></div>
        <div class="meta"><span>Date</span><b>${esc((a.created_at || '').slice(0, 10) || '—')}</b></div>
        <div class="meta"><span>Effective Date</span><b>${esc(a.effective_date || '—')}</b></div>
        <div class="meta"><span>Products</span><b>${a.products.length}</b></div>
      </div>
      ${a.intro ? `<p style="white-space:pre-wrap;line-height:1.55">${esc(a.intro)}</p>` : ''}
    </div>

    <div class="card" id="ack-card">
      <h3>Store Acknowledgment</h3>
      <div id="ack-area"></div>
    </div>

    <div class="card">
      <h3>Products <span class="count">(${a.products.length})</span></h3>
      <div class="product-grid">
        ${a.products.map((p) => `<div class="product-card">
          ${p.image_path ? `<img src="${esc(p.image_path)}" alt="${esc(p.item_code)}">` : '<div class="no-img">No image</div>'}
          <div style="flex:1;min-width:0"><div class="code">${esc(p.item_code)}</div><div class="desc">${esc(p.item_description)}</div><div class="short">${esc(p.short_description)}</div>${pricingGrid(p)}</div>
        </div>`).join('')}
      </div>
      <div class="sig-grid">
        <div class="sig-box"><div class="label">Prepared By</div><div class="name">${esc(a.prepared_by || '—')}</div></div>
        <div class="sig-box"><div class="label">Approved By</div><div class="name">${esc(a.approved_by || '—')}</div></div>
      </div>
    </div>

    <div class="card">
      <h3>Acknowledgment Status <span class="count">(${acked}/${a.stores.length} stores)</span></h3>
      <table><thead><tr><th>Store</th><th>Status</th><th>Date (UTC)</th></tr></thead>
      <tbody>${a.stores.map((s) => `<tr>
        <td><b>${esc(s.store_name)}</b></td>
        <td>${s.acknowledged_at ? '<span class="badge badge-ok">Acknowledged</span>' : '<span class="badge badge-pending">Pending</span>'}</td>
        <td class="muted">${s.acknowledged_at ? esc(s.acknowledged_at) : '—'}</td>
      </tr>`).join('')}</tbody></table>
    </div>`;

  renderAckForm(a);
}

function renderAckForm(a) {
  const area = $('#ack-area');
  const pending = a.stores.filter((s) => !s.acknowledged_at);
  if (!pending.length) {
    area.innerHTML = '<div class="ack-banner ok">All recipient stores have acknowledged this announcement. Thank you!</div>';
    return;
  }
  area.innerHTML = `
    <p class="muted" style="margin-bottom:12px">After reviewing all products, select your store and enter your name to acknowledge receipt.</p>
    <div class="form-grid">
      <div class="field"><label>Your Store <span class="req">*</span></label>
        <select id="ack-store">
          <option value="">Select store...</option>
          ${a.stores.map((s) => `<option value="${s.store_id}" ${s.acknowledged_at ? 'disabled' : ''}>${esc(s.store_name)}${s.acknowledged_at ? ' (acknowledged)' : ''}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Your Name <span class="req">*</span></label><input id="ack-name" placeholder="Store manager / representative"></div>
    </div>
    <button class="btn btn-primary" id="ack-btn">&#10004; Acknowledge Receipt</button>
    <div class="error-text" id="ack-error" style="margin-top:8px"></div>`;

  $('#ack-btn').addEventListener('click', async () => {
    const storeId = $('#ack-store').value;
    const name = $('#ack-name').value.trim();
    const err = $('#ack-error');
    err.textContent = '';
    if (!storeId) { err.textContent = 'Please select your store.'; return; }
    if (!name) { err.textContent = 'Please enter your name.'; return; }
    $('#ack-btn').disabled = true;
    try {
      const res = await fetch(`/api/public/${encodeURIComponent(slug)}/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: Number(storeId), name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Acknowledgment failed.');
      toast('Acknowledgment recorded. Thank you!', 'success');
      await load();
    } catch (e) {
      err.textContent = e.message;
      $('#ack-btn').disabled = false;
    }
  });
}

load();