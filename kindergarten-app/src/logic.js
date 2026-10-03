// Pure business logic (no DOM, no Electron) so it can be unit-tested with plain Node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KGLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const uid = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const toYM = (date) => String(date || '').slice(0, 7); // 'YYYY-MM-DD' -> 'YYYY-MM'

  const todayISO = (d = new Date()) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  const ymIndex = (ym) => {
    const [y, m] = ym.split('-').map(Number);
    return y * 12 + (m - 1);
  };

  // Amounts are kept in cents internally when summing to avoid 0.1+0.2 drift.
  const toCents = (n) => Math.round((Number(n) || 0) * 100);
  const fromCents = (c) => c / 100;

  // Months a child is billed the monthly fee: enrolment month through the
  // current month (or the month they left, if earlier). Inclusive on both ends.
  function billedMonths(child, todayYM) {
    const start = toYM(child.enrolledOn);
    if (!/^\d{4}-\d{2}$/.test(start)) return 0;
    let end = todayYM;
    const left = toYM(child.leftOn);
    if (/^\d{4}-\d{2}$/.test(left) && ymIndex(left) < ymIndex(end)) end = left;
    const n = ymIndex(end) - ymIndex(start) + 1;
    return n > 0 ? n : 0;
  }

  // A child is "active" until their leaving date has passed.
  const isActive = (child, today) => !child.leftOn || child.leftOn >= today;

  function sumCents(list, key) {
    return (list || []).reduce((s, x) => s + toCents(x[key]), 0);
  }

  function childTotals(child, todayYM) {
    const months = billedMonths(child, todayYM);
    const feeCents = toCents(child.monthlyFee) * months;
    const chargesCents = sumCents(child.charges, 'amount');
    const paidCents = sumCents(child.payments, 'amount');
    const dueCents = feeCents + chargesCents;
    return {
      months,
      due: fromCents(dueCents),
      paid: fromCents(paidCents),
      balance: fromCents(dueCents - paidCents), // > 0 means the family owes money
    };
  }

  // Paid vs. expected for one specific month (payments are tagged with the month they cover).
  function monthStatus(child, ym) {
    const start = toYM(child.enrolledOn);
    const left = toYM(child.leftOn);
    const active =
      /^\d{4}-\d{2}$/.test(start) &&
      ymIndex(ym) >= ymIndex(start) &&
      !(/^\d{4}-\d{2}$/.test(left) && ymIndex(ym) > ymIndex(left));
    const dueCents = active ? toCents(child.monthlyFee) : 0;
    const paidCents = (child.payments || [])
      .filter((p) => p.forMonth === ym)
      .reduce((s, p) => s + toCents(p.amount), 0);
    let state = 'n/a';
    if (active) {
      if (dueCents === 0) state = 'free';
      else if (paidCents >= dueCents) state = 'paid';
      else if (paidCents > 0) state = 'partial';
      else state = 'unpaid';
    }
    return { due: fromCents(dueCents), paid: fromCents(paidCents), state };
  }

  function age(dob, now = new Date()) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob || '');
    if (!m) return '';
    let years = now.getFullYear() - Number(m[1]);
    let months = now.getMonth() + 1 - Number(m[2]);
    if (now.getDate() < Number(m[3])) months -= 1;
    if (months < 0) { years -= 1; months += 12; }
    if (years < 0) return '';
    return years > 0 ? `${years}y ${months}m` : `${months}m`;
  }

  const csvCell = (v) => {
    let s = String(v ?? '');
    // Neutralise spreadsheet formula injection (=, +, -, @ at start of a cell).
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  function childrenToCSV(children, today) {
    const todayYM = toYM(today);
    const head = [
      'Child', 'Date of birth', 'Group', 'Status', 'Enrolled', 'Left', 'Monthly fee',
      'Total due', 'Total paid', 'Balance owed',
      'Parent 1', 'Relationship 1', 'Phone 1', 'Email 1',
      'Parent 2', 'Relationship 2', 'Phone 2', 'Email 2',
      'Address', 'Allergies / medical',
    ];
    const rows = children.map((c) => {
      const t = childTotals(c, todayYM);
      const p = c.parents || [];
      const p1 = p[0] || {};
      const p2 = p[1] || {};
      return [
        `${c.firstName} ${c.lastName}`.trim(), c.dob, c.group, isActive(c, today) ? 'Active' : 'Left',
        c.enrolledOn, c.leftOn, c.monthlyFee, t.due, t.paid, t.balance,
        p1.name, p1.relationship, p1.phone, p1.email,
        p2.name, p2.relationship, p2.phone, p2.email,
        p1.address, [c.allergies, c.medical].filter(Boolean).join(' | '),
      ];
    });
    return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  }

  function paymentsToCSV(children) {
    const head = ['Date', 'Child', 'Amount', 'Method', 'For month', 'Note'];
    const rows = [];
    children.forEach((c) =>
      (c.payments || []).forEach((p) =>
        rows.push([p.date, `${c.firstName} ${c.lastName}`.trim(), p.amount, p.method, p.forMonth, p.note])
      )
    );
    rows.sort((a, b) => String(b[0]).localeCompare(String(a[0])));
    return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  }

  // Make imported/loaded data safe to use: fill defaults, drop junk shapes.
  function normalizeData(raw) {
    const d = raw && typeof raw === 'object' ? raw : {};
    const settings = Object.assign(
      { schoolName: 'My Kindergarten', currency: '$' },
      d.settings && typeof d.settings === 'object' ? d.settings : {}
    );
    const arr = (x) => (Array.isArray(x) ? x : []);
    const children = arr(d.children).map((c) => ({
      id: c.id || uid(),
      firstName: String(c.firstName || ''),
      lastName: String(c.lastName || ''),
      dob: String(c.dob || ''),
      group: String(c.group || ''),
      enrolledOn: String(c.enrolledOn || ''),
      leftOn: String(c.leftOn || ''),
      monthlyFee: Number(c.monthlyFee) || 0,
      allergies: String(c.allergies || ''),
      medical: String(c.medical || ''),
      notes: String(c.notes || ''),
      parents: arr(c.parents).map((p) => ({
        id: p.id || uid(),
        name: String(p.name || ''),
        relationship: String(p.relationship || ''),
        phone: String(p.phone || ''),
        email: String(p.email || ''),
        address: String(p.address || ''),
        workplace: String(p.workplace || ''),
        emergency: !!p.emergency,
        canPickUp: p.canPickUp !== false,
      })),
      payments: arr(c.payments).map((p) => ({
        id: p.id || uid(),
        date: String(p.date || ''),
        amount: Number(p.amount) || 0,
        method: String(p.method || ''),
        forMonth: String(p.forMonth || ''),
        note: String(p.note || ''),
      })),
      charges: arr(c.charges).map((x) => ({
        id: x.id || uid(),
        date: String(x.date || ''),
        amount: Number(x.amount) || 0,
        description: String(x.description || ''),
      })),
    }));
    return { version: 1, settings, children };
  }

  return {
    uid, toYM, todayISO, isActive, billedMonths, childTotals, monthStatus, age,
    childrenToCSV, paymentsToCSV, normalizeData, toCents, fromCents,
  };
});
