const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/logic.js');

test('billedMonths counts enrolment month through current month inclusive', () => {
  assert.equal(L.billedMonths({ enrolledOn: '2026-09-15' }, '2026-10'), 2);
  assert.equal(L.billedMonths({ enrolledOn: '2026-10-01' }, '2026-10'), 1);
  assert.equal(L.billedMonths({ enrolledOn: '2027-01-01' }, '2026-10'), 0);
  assert.equal(L.billedMonths({ enrolledOn: '' }, '2026-10'), 0);
});

test('billedMonths stops at the month the child left', () => {
  assert.equal(L.billedMonths({ enrolledOn: '2026-01-10', leftOn: '2026-03-31' }, '2026-10'), 3);
  // leaving date in the future does not extend billing past today
  assert.equal(L.billedMonths({ enrolledOn: '2026-09-01', leftOn: '2027-06-30' }, '2026-10'), 2);
});

test('childTotals: due, paid and balance (no floating point drift)', () => {
  const c = {
    enrolledOn: '2026-08-01', monthlyFee: 100.1,
    charges: [{ amount: 0.2 }],
    payments: [{ amount: 100.1 }, { amount: 0.1 }],
  };
  const t = L.childTotals(c, '2026-10'); // 3 months
  assert.equal(t.months, 3);
  assert.equal(t.due, 300.5); // 300.3 + 0.2
  assert.equal(t.paid, 100.2);
  assert.equal(t.balance, 200.3);
});

test('overpayment gives a negative balance (credit)', () => {
  const c = { enrolledOn: '2026-10-01', monthlyFee: 50, payments: [{ amount: 80 }] };
  assert.equal(L.childTotals(c, '2026-10').balance, -30);
});

test('monthStatus: paid / partial / unpaid / not enrolled', () => {
  const c = {
    enrolledOn: '2026-09-01', monthlyFee: 100,
    payments: [{ amount: 100, forMonth: '2026-09' }, { amount: 40, forMonth: '2026-10' }],
  };
  assert.equal(L.monthStatus(c, '2026-09').state, 'paid');
  assert.equal(L.monthStatus(c, '2026-10').state, 'partial');
  assert.equal(L.monthStatus(c, '2026-11').state, 'unpaid');
  assert.equal(L.monthStatus(c, '2026-08').state, 'n/a');
});

test('age formats years and months', () => {
  assert.equal(L.age('2022-01-15', new Date(2026, 9, 3)), '4y 8m');
  assert.equal(L.age('2026-07-20', new Date(2026, 9, 3)), '2m');
  assert.equal(L.age('', new Date()), '');
});

test('CSV escapes commas, quotes and neutralises formula injection', () => {
  const csv = L.childrenToCSV([{
    firstName: '=cmd', lastName: 'O"Neil, Jr', enrolledOn: '2026-10-01', monthlyFee: 10,
    parents: [{ name: 'Mum', phone: '+972 50' }], payments: [],
  }], '2026-10-03');
  const row = csv.split('\r\n')[1];
  assert.ok(row.startsWith(`"'=cmd O""Neil, Jr"`), row);
  assert.ok(row.includes(`'+972 50`), row);
});

test('isActive: active until the leaving date has passed', () => {
  assert.equal(L.isActive({ leftOn: '' }, '2026-10-03'), true);
  assert.equal(L.isActive({ leftOn: '2026-12-31' }, '2026-10-03'), true);
  assert.equal(L.isActive({ leftOn: '2026-09-30' }, '2026-10-03'), false);
});

test('normalizeData tolerates garbage input and fills defaults', () => {
  assert.deepEqual(L.normalizeData(null).children, []);
  const d = L.normalizeData({ children: [{ firstName: 'Ann', parents: 'bad', payments: [{ amount: '12.5' }] }] });
  assert.equal(d.children[0].parents.length, 0);
  assert.equal(d.children[0].payments[0].amount, 12.5);
  assert.equal(d.settings.schoolName, 'My Kindergarten');
});
