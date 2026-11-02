// Shared by the Mini App (live preview) and the server (actual bookkeeping),
// so what the user sees before pressing a button is exactly what gets saved.

export const fmt = (n) => Math.round(n).toLocaleString('ru-RU') + ' ₽';

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

export const normalizeNote = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const monthStart = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), 1).getTime();

// Fixed payments are filled first (only what is still missing this month).
// mode 'pct': the remainder is split by percentages. With exactly 100% the last
//   envelope absorbs rounding; with less, the rest stays unallocated ("free").
// mode 'sum': each category is topped up to its monthly ruble budget (e.need = what is
//   still missing); if the money doesn't cover everything it's shared in proportion to
//   the needs, and anything above all budgets stays unallocated.
export function distribute(amount, envelopes, mode = 'pct') {
  if (mode === 'sum') return distributeSums(amount, envelopes);
  const a = Math.max(0, Math.floor(Number(amount) || 0));
  const byId = {};
  let rest = a;
  let fixedNeed = 0;
  for (const e of envelopes) {
    if (e.kind !== 'fixed') continue;
    const need = Math.max(0, e.fixedNeed ?? e.value);
    const v = Math.min(rest, need);
    fixedNeed += need;
    byId[e.id] = v;
    rest -= v;
  }
  const pct = envelopes.filter((e) => e.kind === 'pct');
  const pctTotal = pct.reduce((s, e) => s + e.value, 0);
  const base = rest;
  let given = 0;
  pct.forEach((e, i) => {
    let v = Math.floor((base * e.value) / Math.max(100, pctTotal));
    if (pctTotal >= 100 && i === pct.length - 1) v = base - given;
    byId[e.id] = v;
    given += v;
  });
  return { amount: a, byId, free: base - given, fixedNeed, short: a < fixedNeed, shortBy: Math.max(0, fixedNeed - a) };
}

function distributeSums(amount, envelopes) {
  const a = Math.max(0, Math.floor(Number(amount) || 0));
  const byId = {};
  let rest = a;
  let fixedNeed = 0;
  for (const e of envelopes) {
    if (e.kind !== 'fixed') continue;
    const need = Math.max(0, e.fixedNeed ?? e.value);
    const v = Math.min(rest, need);
    fixedNeed += need;
    byId[e.id] = v;
    rest -= v;
  }
  const cats = envelopes.filter((e) => e.kind === 'pct');
  const needs = cats.map((e) => Math.max(0, e.need ?? e.budget ?? 0));
  const totalNeed = needs.reduce((s, n) => s + n, 0);
  let given = 0;
  if (rest >= totalNeed) {
    cats.forEach((e, i) => (byId[e.id] = needs[i]));
    given = totalNeed;
  } else {
    cats.forEach((e, i) => {
      byId[e.id] = Math.floor((rest * needs[i]) / totalNeed);
      given += byId[e.id];
    });
    // Rubles lost to rounding go to the categories with the biggest needs.
    const order = cats.map((e, i) => i).sort((x, y) => needs[y] - needs[x]);
    for (let j = 0; given < rest && j < order.length; j++) {
      byId[cats[order[j]].id]++;
      given++;
    }
  }
  return {
    amount: a,
    byId,
    free: rest - given,
    fixedNeed,
    short: a < fixedNeed,
    shortBy: Math.max(0, fixedNeed - a),
    catsShortBy: Math.max(0, totalNeed - rest)
  };
}

// Days until the next payday; a payday of 31 means "last day of the month".
export function daysUntilPayday(paydays, now = new Date()) {
  const days = paydays?.length ? paydays : [1];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = 1; i <= 62; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    if (days.some((p) => Math.min(p, last) === d.getDate())) return i;
  }
  return 30;
}
