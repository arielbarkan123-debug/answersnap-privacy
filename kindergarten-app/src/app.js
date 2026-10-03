(function () {
  'use strict';
  const L = window.KGLogic;
  const hasApi = !!window.kgApi;

  // ---------- storage: file on disk in the desktop app, localStorage in a plain browser ----------
  const storage = hasApi
    ? { load: () => window.kgApi.load(), save: (d, o) => window.kgApi.save(d, o) }
    : {
        load: async () => {
          try {
            const t = localStorage.getItem('kg-data');
            return { ok: true, data: t ? JSON.parse(t) : null };
          } catch (e) { return { ok: false, error: e.message }; }
        },
        save: async (d) => {
          try { localStorage.setItem('kg-data', JSON.stringify(d)); return { ok: true }; }
          catch (e) { return { ok: false, error: e.message }; }
        },
      };

  // ---------- state ----------
  let state = L.normalizeData(null);
  let selectedId = null;
  let tab = 'info';
  let canSave = false; // stays false if loading failed, so we never overwrite unreadable data

  const $ = (s) => document.querySelector(s);
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => L.todayISO();
  const nowYM = () => L.toYM(today());
  const cur = () => state.settings.currency || '';
  const money = (n) => {
    const v = Number(n) || 0;
    return (v < 0 ? '-' : '') + cur() + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const fmtDate = (iso) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
    return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const fmtMonth = (ym) => {
    if (!/^\d{4}-\d{2}$/.test(ym || '')) return '';
    return new Date(ym + '-01T00:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  };
  const fullName = (c) => `${c.firstName} ${c.lastName}`.trim();
  const getChild = (id) => state.children.find((c) => c.id === id);
  const totals = (c) => L.childTotals(c, nowYM());

  // ---------- saving ----------
  let saveChain = Promise.resolve();
  function persist(opts) {
    if (!canSave) return Promise.resolve({ ok: false });
    const status = $('#saveStatus');
    status.className = 'save-status';
    status.textContent = 'Saving…';
    const snapshot = JSON.parse(JSON.stringify(state));
    saveChain = saveChain.then(() => storage.save(snapshot, opts)).then((r) => {
      if (r && r.ok) {
        status.textContent = 'Saved ✓ ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else {
        status.className = 'save-status err';
        status.textContent = '⚠ NOT SAVED';
        alert('Could not save your data!\n\n' + ((r && r.error) || 'Unknown error') + '\n\nUse the Backup button to keep a copy of your data.');
      }
      return r;
    });
    return saveChain;
  }
  function commit() { persist(); renderAll(); }

  // ---------- dialogs ----------
  const dlg = $('#dlg');
  function openDialog(html, wide) {
    dlg.className = wide ? 'wide' : '';
    dlg.innerHTML = html;
    if (!dlg.open) dlg.showModal();
  }
  function closeDialog() { if (dlg.open) dlg.close(); }

  function fieldHTML(f, values) {
    const val = values[f.name] ?? '';
    const full = f.full ? ' full' : '';
    if (f.type === 'checkbox') {
      return `<label class="check${full}"><input type="checkbox" name="${f.name}" ${val ? 'checked' : ''}> ${esc(f.label)}</label>`;
    }
    let input;
    if (f.type === 'textarea') {
      input = `<textarea name="${f.name}">${esc(val)}</textarea>`;
    } else if (f.type === 'select') {
      input = `<select name="${f.name}">${f.options.map((o) => {
        const [v, l] = Array.isArray(o) ? o : [o, o];
        return `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l || '—')}</option>`;
      }).join('')}</select>`;
    } else {
      input = `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(val)}"` +
        `${f.required ? ' required' : ''}${f.step ? ` step="${f.step}"` : ''}${f.min != null ? ` min="${f.min}"` : ''}` +
        `${f.list ? ` list="${f.list}"` : ''}${f.autofocus ? ' autofocus' : ''}>`;
    }
    return `<label class="${full.trim()}">${esc(f.label)}${f.required ? ' *' : ''}${input}</label>`;
  }

  // Generic form dialog. onSubmit(values) returns an error string to keep the dialog open.
  function openForm({ title, fields, values = {}, submit = 'Save', onSubmit, extra = '' }) {
    openDialog(
      `<form id="dlgform">
        <div class="dlg-head">${esc(title)}</div>
        <div class="dlg-body"><div class="form">${fields.map((f) => fieldHTML(f, values)).join('')}</div>
          ${extra}<div class="form-error" id="formError" hidden></div></div>
        <div class="dlg-foot">
          <button type="button" class="btn" data-action="close-dlg">Cancel</button>
          <button type="submit" class="btn primary">${esc(submit)}</button>
        </div>
      </form>`
    );
    const form = $('#dlgform');
    const first = form.querySelector('input:not([type=checkbox]), select, textarea');
    if (first) first.focus();
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const out = {};
      for (const f of fields) {
        const el = form.elements[f.name];
        if (f.type === 'checkbox') out[f.name] = el.checked;
        else if (f.type === 'number') out[f.name] = el.value === '' ? 0 : Number(el.value);
        else out[f.name] = String(el.value).trim();
        if (f.required && f.type !== 'number' && !out[f.name]) {
          showFormError(`${f.label} is required.`);
          return;
        }
      }
      const err = onSubmit(out);
      if (err) showFormError(err);
      else closeDialog();
    });
  }
  function showFormError(msg) {
    const el = $('#formError');
    el.textContent = msg;
    el.hidden = false;
  }

  // ---------- rendering ----------
  function renderAll() {
    $('#schoolName').textContent = state.settings.schoolName || 'Kindergarten';
    document.title = (state.settings.schoolName || 'Kindergarten') + ' – Kindergarten Manager';
    renderSummary();
    renderList();
    renderDetail();
  }

  function renderSummary() {
    const t = today();
    const ym = nowYM();
    const active = state.children.filter((c) => L.isActive(c, t));
    const outstanding = state.children.reduce((s, c) => s + Math.max(0, totals(c).balance), 0);
    const collected = state.children.reduce(
      (s, c) => s + c.payments.filter((p) => L.toYM(p.date) === ym).reduce((a, p) => a + L.toCents(p.amount), 0), 0) / 100;
    const behind = active.filter((c) => ['unpaid', 'partial'].includes(L.monthStatus(c, ym).state)).length;
    $('#summary').innerHTML =
      stat('Active children', active.length) +
      stat('Total owed to you', money(outstanding), outstanding > 0 ? 'owe' : '') +
      stat('Collected this month', money(collected)) +
      stat(`Not fully paid for ${fmtMonth(ym)}`, behind) +
      (hasApi ? '' : `<div class="stat" style="background:var(--warn-bg)"><div class="k">Browser mode</div><div class="v" style="font-size:13px;font-weight:500">Data is stored in this browser only.<br>Use Backup often, or use the desktop app.</div></div>`);
  }
  const stat = (k, v, cls = '') => `<div class="stat"><div class="k">${esc(k)}</div><div class="v ${cls}">${esc(v)}</div></div>`;

  function visibleChildren() {
    const q = $('#search').value.trim().toLowerCase();
    const f = $('#filter').value;
    const t = today();
    return state.children
      .filter((c) => {
        if (f === 'active' && !L.isActive(c, t)) return false;
        if (f === 'inactive' && L.isActive(c, t)) return false;
        if (f === 'owing' && totals(c).balance <= 0.004) return false;
        if (!q) return true;
        const hay = [fullName(c), c.group, ...c.parents.flatMap((p) => [p.name, p.phone, p.email])].join(' ').toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => (a.lastName + a.firstName).toLowerCase().localeCompare((b.lastName + b.firstName).toLowerCase()));
  }

  function balancePill(c) {
    if (!L.isActive(c, today()) && totals(c).balance <= 0.004) return '<span class="pill mute">Left</span>';
    const b = totals(c).balance;
    if (b > 0.004) return `<span class="pill bad">Owes ${esc(money(b))}</span>`;
    if (b < -0.004) return `<span class="pill ok">Credit ${esc(money(-b))}</span>`;
    return '<span class="pill ok">Paid up</span>';
  }

  function renderList() {
    const list = visibleChildren();
    $('#childList').innerHTML = list.length
      ? list.map((c) => `<li tabindex="0" data-id="${esc(c.id)}" class="${c.id === selectedId ? 'sel' : ''}">
          <div><div class="nm">${esc(fullName(c))}</div>
          <div class="sub">${esc([c.group, L.age(c.dob)].filter(Boolean).join(' · ') || '—')}</div></div>
          ${balancePill(c)}</li>`).join('')
      : `<li class="empty">${state.children.length ? 'No children match.' : 'No children yet.<br>Click “+ Add child” to start.'}</li>`;
  }

  function renderDetail() {
    const c = getChild(selectedId);
    const box = $('#detail');
    if (!c) {
      box.innerHTML = '<div class="placeholder"><h2>Select a child</h2><p>Choose a child on the left to see their details, parents and payments.</p></div>';
      return;
    }
    const t = totals(c);
    const status = L.isActive(c, today()) ? '<span class="pill ok">Attending</span>' : `<span class="pill mute">Left ${esc(fmtDate(c.leftOn))}</span>`;
    box.innerHTML = `
      <div class="detail-head"><h2>${esc(fullName(c))}</h2>${status}${balancePill(c)}</div>
      <div class="detail-sub">${esc([c.group, L.age(c.dob) && 'Age ' + L.age(c.dob)].filter(Boolean).join(' · '))}</div>
      <div class="tabs" role="tablist">
        <button class="tab ${tab === 'info' ? 'on' : ''}" data-action="tab" data-tab="info">Child info</button>
        <button class="tab ${tab === 'parents' ? 'on' : ''}" data-action="tab" data-tab="parents">Parents (${c.parents.length})</button>
        <button class="tab ${tab === 'payments' ? 'on' : ''}" data-action="tab" data-tab="payments">Payments${t.balance > 0.004 ? ' ⚠' : ''}</button>
      </div>
      ${tab === 'info' ? infoTab(c) : tab === 'parents' ? parentsTab(c) : paymentsTab(c, t)}`;
  }

  const kv = (k, v) => `<div><div class="k">${esc(k)}</div><div class="v">${v ? esc(v) : '<span style="color:var(--muted)">—</span>'}</div></div>`;

  function infoTab(c) {
    return `<div class="grid">
        ${kv('First name', c.firstName)}${kv('Last name', c.lastName)}
        ${kv('Date of birth', fmtDate(c.dob))}${kv('Group / class', c.group)}
        ${kv('Enrolled on', fmtDate(c.enrolledOn))}${kv('Left on', fmtDate(c.leftOn))}
        ${kv('Monthly fee', money(c.monthlyFee))}
        ${kv('Allergies', c.allergies)}${kv('Medical information', c.medical)}${kv('Notes', c.notes)}
      </div>
      <div class="row-actions">
        <button class="btn" data-action="edit-child">Edit child</button>
        <button class="btn danger" data-action="delete-child">Delete child…</button>
      </div>`;
  }

  function parentsTab(c) {
    const others = state.children.filter((o) => o.id !== c.id && o.parents.length);
    const cards = c.parents.map((p) => `<div class="card">
        <h3>${esc(p.name)} ${p.relationship ? `<span class="pill mute">${esc(p.relationship)}</span>` : ''}
          ${p.emergency ? '<span class="pill bad">Emergency contact</span>' : ''}
          ${p.canPickUp ? '<span class="pill ok">Can pick up</span>' : '<span class="pill warn">No pick-up</span>'}</h3>
        <div class="line"><span class="k">Phone</span><span>${esc(p.phone) || '—'}</span></div>
        <div class="line"><span class="k">Email</span><span>${esc(p.email) || '—'}</span></div>
        <div class="line"><span class="k">Address</span><span>${esc(p.address) || '—'}</span></div>
        <div class="line"><span class="k">Workplace</span><span>${esc(p.workplace) || '—'}</span></div>
        <div class="row-actions" style="margin-top:10px">
          <button class="btn small" data-action="edit-parent" data-pid="${esc(p.id)}">Edit</button>
          <button class="btn small danger" data-action="delete-parent" data-pid="${esc(p.id)}">Remove</button>
        </div></div>`).join('');
    return `<div class="section-title"><strong>Parents &amp; guardians</strong><span>
        ${others.length ? '<button class="btn small" data-action="copy-parents">Copy from sibling…</button> ' : ''}
        <button class="btn primary small" data-action="add-parent">+ Add parent / guardian</button></span></div>
      ${cards ? `<div class="cards">${cards}</div>` : '<p style="color:var(--muted)">No parents added yet.</p>'}`;
  }

  function paymentsTab(c, t) {
    const ym = nowYM();
    const [y, m] = ym.split('-').map(Number);
    const chips = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(y, m - 1 - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const s = L.monthStatus(c, key);
      chips.push(`<div class="m ${s.state}" title="${esc(s.state)}"><div class="ml">${esc(fmtMonth(key))}</div>` +
        (s.state === 'n/a' ? '—' : `${esc(money(s.paid))}`) + '</div>');
    }
    const rows = [
      ...c.payments.map((p) => ({ kind: 'pay', date: p.date, item: p })),
      ...c.charges.map((x) => ({ kind: 'chg', date: x.date, item: x })),
    ].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const ledger = rows.map((r) => r.kind === 'pay'
      ? `<tr><td>${esc(fmtDate(r.item.date))}</td><td><span class="pill ok">Payment</span></td>
          <td>${esc(['for ' + fmtMonth(r.item.forMonth), r.item.method, r.item.note].filter((x) => x && x !== 'for ').join(' · '))}</td>
          <td class="num">${esc(money(r.item.amount))}</td>
          <td class="num"><button class="btn small" data-action="receipt" data-pid="${esc(r.item.id)}">Receipt</button>
            <button class="btn small" data-action="edit-payment" data-pid="${esc(r.item.id)}">Edit</button>
            <button class="btn small danger" data-action="delete-payment" data-pid="${esc(r.item.id)}">Delete</button></td></tr>`
      : `<tr><td>${esc(fmtDate(r.item.date))}</td><td><span class="pill warn">Charge</span></td>
          <td>${esc(r.item.description)}</td><td class="num">${esc(money(r.item.amount))}</td>
          <td class="num"><button class="btn small" data-action="edit-charge" data-cid="${esc(r.item.id)}">Edit</button>
            <button class="btn small danger" data-action="delete-charge" data-cid="${esc(r.item.id)}">Delete</button></td></tr>`).join('');
    const balLabel = t.balance > 0.004 ? 'Owes' : t.balance < -0.004 ? 'Credit' : 'Balance';
    return `<div class="totals">
        ${stat('Total due', money(t.due))}${stat('Total paid', money(t.paid))}
        ${stat(balLabel, money(Math.abs(t.balance)), t.balance > 0.004 ? 'owe' : '')}</div>
      <p style="color:var(--muted);margin-top:-4px">Due = monthly fee ${esc(money(c.monthlyFee))} × ${t.months} month${t.months === 1 ? '' : 's'}
        (from ${esc(fmtMonth(L.toYM(c.enrolledOn)) || '?')}${c.leftOn ? ' to ' + esc(fmtMonth(L.toYM(c.leftOn))) : ' to this month'}) + extra charges.</p>
      <div class="section-title"><strong>Last 12 months (amount paid for each month)</strong></div>
      <div class="months">${chips.join('')}</div>
      <div class="section-title"><strong>Payments &amp; charges</strong><span>
        <button class="btn small" data-action="add-charge">+ Add charge</button>
        <button class="btn primary small" data-action="add-payment">+ Record payment</button></span></div>
      ${rows.length ? `<table><thead><tr><th>Date</th><th>Type</th><th>Details</th><th class="num">Amount</th><th></th></tr></thead><tbody>${ledger}</tbody></table>`
        : '<p style="color:var(--muted)">No payments recorded yet.</p>'}`;
  }

  // ---------- forms ----------
  const METHODS = ['Cash', 'Bank transfer', 'Credit card', 'Check', 'Other'];
  const groupList = () => `<datalist id="groups">${[...new Set(state.children.map((c) => c.group).filter(Boolean))].map((g) => `<option value="${esc(g)}">`).join('')}</datalist>`;

  function childForm(c) {
    const isNew = !c;
    const v = c || { enrolledOn: today(), monthlyFee: state.settings.defaultMonthlyFee || 0 };
    openForm({
      title: isNew ? 'Add child' : 'Edit child',
      values: v,
      extra: groupList(),
      fields: [
        { name: 'firstName', label: 'First name', required: true, autofocus: true },
        { name: 'lastName', label: 'Last name', required: true },
        { name: 'dob', label: 'Date of birth', type: 'date' },
        { name: 'group', label: 'Group / class', list: 'groups' },
        { name: 'enrolledOn', label: 'Enrolled on', type: 'date', required: true },
        { name: 'monthlyFee', label: `Monthly fee (${cur()})`, type: 'number', step: '0.01', min: 0 },
        { name: 'leftOn', label: 'Left on (leave empty if still attending)', type: 'date' },
        { name: 'allergies', label: 'Allergies', type: 'textarea', full: true },
        { name: 'medical', label: 'Medical information', type: 'textarea', full: true },
        { name: 'notes', label: 'Notes', type: 'textarea', full: true },
      ],
      onSubmit: (o) => {
        if (o.leftOn && o.leftOn < o.enrolledOn) return '“Left on” cannot be before “Enrolled on”.';
        if (isNew) {
          const child = { id: L.uid(), ...o, parents: [], payments: [], charges: [] };
          state.children.push(child);
          selectedId = child.id;
          tab = 'parents';
        } else {
          Object.assign(c, o);
        }
        commit();
      },
    });
  }

  function parentForm(c, p) {
    openForm({
      title: p ? 'Edit parent / guardian' : 'Add parent / guardian',
      values: p || { canPickUp: true },
      extra: '<datalist id="rels"><option value="Mother"><option value="Father"><option value="Guardian"><option value="Grandparent"></datalist>',
      fields: [
        { name: 'name', label: 'Full name', required: true, autofocus: true },
        { name: 'relationship', label: 'Relationship to child', list: 'rels' },
        { name: 'phone', label: 'Phone', type: 'tel' },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'address', label: 'Home address', full: true },
        { name: 'workplace', label: 'Workplace / work phone', full: true },
        { name: 'emergency', label: 'Emergency contact', type: 'checkbox' },
        { name: 'canPickUp', label: 'Authorized to pick up the child', type: 'checkbox' },
      ],
      onSubmit: (o) => {
        if (p) Object.assign(p, o);
        else c.parents.push({ id: L.uid(), ...o });
        commit();
      },
    });
  }

  function paymentForm(c, p) {
    openForm({
      title: p ? 'Edit payment' : `Record payment – ${fullName(c)}`,
      values: p || { date: today(), forMonth: nowYM(), method: 'Cash', amount: Math.max(0, totals(c).balance) || c.monthlyFee || '' },
      fields: [
        { name: 'date', label: 'Date received', type: 'date', required: true },
        { name: 'amount', label: `Amount (${cur()})`, type: 'number', step: '0.01', min: 0.01, required: true, autofocus: true },
        { name: 'forMonth', label: 'Payment is for month', type: 'month', required: true },
        { name: 'method', label: 'Method', type: 'select', options: METHODS },
        { name: 'note', label: 'Note', full: true },
      ],
      onSubmit: (o) => {
        if (!(o.amount > 0)) return 'Amount must be greater than 0.';
        if (p) Object.assign(p, o);
        else c.payments.push({ id: L.uid(), ...o });
        commit();
      },
    });
  }

  function chargeForm(c, x) {
    openForm({
      title: x ? 'Edit charge' : `Add extra charge – ${fullName(c)}`,
      values: x || { date: today() },
      fields: [
        { name: 'date', label: 'Date', type: 'date', required: true },
        { name: 'amount', label: `Amount (${cur()})`, type: 'number', step: '0.01', min: 0.01, required: true },
        { name: 'description', label: 'Description (e.g. registration fee, trip, uniform)', required: true, full: true },
      ],
      onSubmit: (o) => {
        if (!(o.amount > 0)) return 'Amount must be greater than 0.';
        if (x) Object.assign(x, o);
        else c.charges.push({ id: L.uid(), ...o });
        commit();
      },
    });
  }

  function settingsDialog() {
    openForm({
      title: 'Settings',
      values: state.settings,
      fields: [
        { name: 'schoolName', label: 'Kindergarten name', required: true, full: true },
        { name: 'currency', label: 'Currency symbol (e.g. $, €, ₪)' },
        { name: 'defaultMonthlyFee', label: 'Default monthly fee for new children', type: 'number', step: '0.01', min: 0 },
      ],
      extra: hasApi
        ? '<p style="color:var(--muted);margin-top:14px">Your data is stored only on this computer and backed up automatically once a day. <button type="button" class="btn small" data-action="open-folder">Open data folder</button></p>'
        : '<p style="color:var(--muted);margin-top:14px">Running in a web browser: data is saved inside this browser only. Use <b>Backup</b> regularly.</p>',
      onSubmit: (o) => { Object.assign(state.settings, o); commit(); },
    });
  }

  function overviewDialog(ym) {
    ym = ym || nowYM();
    const rows = state.children
      .map((c) => ({ c, s: L.monthStatus(c, ym) }))
      .filter((r) => r.s.state !== 'n/a')
      .sort((a, b) => fullName(a.c).toLowerCase().localeCompare(fullName(b.c).toLowerCase()));
    const due = rows.reduce((s, r) => s + L.toCents(r.s.due), 0) / 100;
    const paid = rows.reduce((s, r) => s + L.toCents(r.s.paid), 0) / 100;
    const pill = { paid: 'ok', partial: 'warn', unpaid: 'bad', free: 'mute' };
    openDialog(
      `<div class="dlg-head">Monthly overview</div>
       <div class="dlg-body">
         <label style="display:flex;gap:10px;align-items:center;margin-bottom:12px">Month <input type="month" id="ovMonth" value="${esc(ym)}" style="width:auto"></label>
         <div class="totals">${stat('Expected', money(due))}${stat('Received', money(paid))}${stat('Still missing', money(Math.max(0, due - paid)), due - paid > 0 ? 'owe' : '')}</div>
         ${rows.length ? `<table><thead><tr><th>Child</th><th>Group</th><th class="num">Fee</th><th class="num">Paid for ${esc(fmtMonth(ym))}</th><th>Status</th></tr></thead><tbody>
           ${rows.map(({ c, s }) => `<tr><td><a href="#" data-action="goto-child" data-id="${esc(c.id)}">${esc(fullName(c))}</a></td><td>${esc(c.group)}</td>
             <td class="num">${esc(money(s.due))}</td><td class="num">${esc(money(s.paid))}</td>
             <td><span class="pill ${pill[s.state]}">${esc(s.state)}</span></td></tr>`).join('')}</tbody></table>`
          : '<p style="color:var(--muted)">No enrolled children in this month.</p>'}
       </div>
       <div class="dlg-foot"><button class="btn" data-action="close-dlg">Close</button></div>`, true);
    $('#ovMonth').addEventListener('change', (e) => { if (e.target.value) overviewDialog(e.target.value); });
  }

  function copyParentsDialog(c) {
    const options = state.children.filter((o) => o.id !== c.id && o.parents.length).map((o) => [o.id, fullName(o)]);
    openForm({
      title: 'Copy parents from a sibling',
      values: { from: options[0][0] },
      fields: [{ name: 'from', label: 'Copy parents of', type: 'select', options, full: true }],
      submit: 'Copy',
      onSubmit: (o) => {
        const src = getChild(o.from);
        if (!src) return 'Choose a child.';
        src.parents.forEach((p) => c.parents.push({ ...p, id: L.uid() }));
        commit();
      },
    });
  }

  function printReceipt(c, p) {
    const t = totals(c);
    const payer = (c.parents[0] && c.parents[0].name) || 'Parent / guardian';
    $('#printArea').innerHTML = `
      <h2>${esc(state.settings.schoolName)}</h2>
      <div>Payment receipt &nbsp;·&nbsp; No. ${esc(p.id.slice(-6).toUpperCase())}</div>
      <table>
        <tr><th>Date received</th><td>${esc(fmtDate(p.date))}</td></tr>
        <tr><th>Received from</th><td>${esc(payer)}</td></tr>
        <tr><th>For child</th><td>${esc(fullName(c))}${c.group ? ' (' + esc(c.group) + ')' : ''}</td></tr>
        <tr><th>Payment for</th><td>${esc(fmtMonth(p.forMonth))}</td></tr>
        <tr><th>Method</th><td>${esc(p.method)}</td></tr>
        ${p.note ? `<tr><th>Note</th><td>${esc(p.note)}</td></tr>` : ''}
        <tr><th>Amount received</th><td><strong>${esc(money(p.amount))}</strong></td></tr>
        <tr><th>Account balance now</th><td>${t.balance > 0.004 ? 'Owes ' + esc(money(t.balance)) : t.balance < -0.004 ? 'Credit ' + esc(money(-t.balance)) : 'Paid in full'}</td></tr>
      </table>
      <p style="margin-top:50px">Signature: ______________________________</p>`;
    window.addEventListener('afterprint', () => { $('#printArea').innerHTML = ''; }, { once: true });
    window.print();
  }

  // ---------- backup / restore / export ----------
  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  // Leading BOM so Excel opens UTF-8 CSVs (names in any language) correctly.
  const csvDownload = (name, text) => download(name, '﻿' + text, 'text/csv;charset=utf-8');

  function restoreFromText(text) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { alert('That file is not a valid backup (not readable).'); return; }
    if (!obj || !Array.isArray(obj.children)) { alert('That file does not look like a Kindergarten Manager backup.'); return; }
    const data = L.normalizeData(obj);
    const msg = `Restore backup with ${data.children.length} children?\n\nThis REPLACES everything currently in the app. ` +
      (hasApi ? 'The current data is kept in the backups folder first.' : 'Use Backup first if you want to keep the current data.');
    if (!confirm(msg)) return;
    state = data;
    canSave = true;
    selectedId = null;
    $('#fatal').hidden = true;
    persist({ snapshot: true });
    renderAll();
  }

  // ---------- actions ----------
  const actions = {
    'close-dlg': () => closeDialog(),
    tab: (d) => { tab = d.tab; renderDetail(); },
    'add-child': () => childForm(null),
    'edit-child': () => childForm(getChild(selectedId)),
    'delete-child': () => {
      const c = getChild(selectedId);
      if (!c || !confirm(`Delete ${fullName(c)} and ALL their parent and payment records?\n\nThis cannot be undone.`)) return;
      state.children = state.children.filter((x) => x.id !== c.id);
      selectedId = null;
      commit();
    },
    'add-parent': () => parentForm(getChild(selectedId), null),
    'edit-parent': (d) => { const c = getChild(selectedId); parentForm(c, c.parents.find((p) => p.id === d.pid)); },
    'delete-parent': (d) => {
      const c = getChild(selectedId);
      const p = c.parents.find((x) => x.id === d.pid);
      if (p && confirm(`Remove ${p.name} from ${fullName(c)}?`)) { c.parents = c.parents.filter((x) => x.id !== d.pid); commit(); }
    },
    'copy-parents': () => copyParentsDialog(getChild(selectedId)),
    'add-payment': () => paymentForm(getChild(selectedId), null),
    'edit-payment': (d) => { const c = getChild(selectedId); paymentForm(c, c.payments.find((p) => p.id === d.pid)); },
    'delete-payment': (d) => {
      const c = getChild(selectedId);
      const p = c.payments.find((x) => x.id === d.pid);
      if (p && confirm(`Delete the ${money(p.amount)} payment from ${fmtDate(p.date)}?`)) { c.payments = c.payments.filter((x) => x.id !== d.pid); commit(); }
    },
    receipt: (d) => { const c = getChild(selectedId); printReceipt(c, c.payments.find((p) => p.id === d.pid)); },
    'add-charge': () => chargeForm(getChild(selectedId), null),
    'edit-charge': (d) => { const c = getChild(selectedId); chargeForm(c, c.charges.find((x) => x.id === d.cid)); },
    'delete-charge': (d) => {
      const c = getChild(selectedId);
      const x = c.charges.find((y) => y.id === d.cid);
      if (x && confirm(`Delete the charge “${x.description}” (${money(x.amount)})?`)) { c.charges = c.charges.filter((y) => y.id !== d.cid); commit(); }
    },
    overview: () => overviewDialog(),
    'goto-child': (d) => { selectedId = d.id; tab = 'payments'; closeDialog(); renderAll(); },
    settings: () => settingsDialog(),
    'open-folder': () => window.kgApi && window.kgApi.openFolder(),
    'export-children': () => csvDownload(`children-${today()}.csv`, L.childrenToCSV(state.children, today())),
    'export-payments': () => csvDownload(`payments-${today()}.csv`, L.paymentsToCSV(state.children)),
    backup: () => download(`kindergarten-backup-${today()}.json`, JSON.stringify(state, null, 2), 'application/json'),
    restore: () => { $('#restoreFile').value = ''; $('#restoreFile').click(); },
    'start-fresh': () => {
      if (!confirm('Start with an empty list? Your unreadable data file was set aside as a copy and is not deleted.')) return;
      state = L.normalizeData(null); canSave = true; $('#fatal').hidden = true; persist(); renderAll();
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (el) {
      e.preventDefault();
      const fn = actions[el.dataset.action];
      if (fn) fn(el.dataset);
      return;
    }
    const li = e.target.closest('#childList li[data-id]');
    if (li) { selectedId = li.dataset.id; renderAll(); }
  });
  $('#childList').addEventListener('keydown', (e) => {
    const li = e.target.closest('li[data-id]');
    if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectedId = li.dataset.id; renderAll(); }
  });
  $('#search').addEventListener('input', renderList);
  $('#filter').addEventListener('change', renderList);
  $('#restoreFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) f.text().then(restoreFromText);
  });
  // Clicking the dark area around a dialog closes it.
  dlg.addEventListener('mousedown', (e) => { if (e.target === dlg) closeDialog(); });

  // ---------- start ----------
  function showFatal(msg) {
    const f = $('#fatal');
    f.hidden = false;
    f.innerHTML = `<div class="box"><h2>Could not open your saved data</h2><p>${esc(msg)}</p>
      <p>Nothing has been deleted or changed. You can restore from a backup file, or start with an empty list.</p>
      <div class="row-actions"><button class="btn primary" data-action="restore">Restore from a backup file…</button>
      <button class="btn" data-action="start-fresh">Start with empty data</button></div></div>`;
  }

  storage.load().then((r) => {
    if (!r.ok) { showFatal(r.error); renderAll(); return; }
    state = L.normalizeData(r.data);
    canSave = true;
    renderAll();
  });
})();
