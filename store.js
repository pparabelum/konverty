// On-device bookkeeping: the same rules as the bot's server (server/budget.js, server/leaks.js),
// kept in localStorage so the app needs no server at all.
import { distribute, daysUntilPayday, monthStart, normalizeNote, fmt, plural } from './shared.js';

const KEY = 'raspredelitel:v1';
const DAY = 86400000;
export const PALETTE = ['#7C9CF5', '#F2A65A', '#4FBFAE', '#9B87F5', '#F27BA0', '#E86A5C', '#8C9199', '#FFC861', '#7FE0C4', '#9FB8FF'];

export class UserError extends Error {}

const DEFAULT_ENVELOPES = [
  { name: 'Жильё', color: '#7C9CF5', kind: 'fixed', value: 30000 },
  { name: 'Еда', color: '#F2A65A', kind: 'pct', value: 30 },
  { name: 'Подушка', color: '#9B87F5', kind: 'pct', value: 20 },
  { name: 'Развлечения', color: '#F27BA0', kind: 'pct', value: 15 },
  { name: 'Прочее', color: '#8C9199', kind: 'pct', value: 15 },
  { name: 'Транспорт', color: '#4FBFAE', kind: 'pct', value: 10 },
  { name: 'Здоровье', color: '#E86A5C', kind: 'pct', value: 10 }
];

// Envelope-name pattern → note keywords, for guessing where a quick entry belongs.
const KEYWORDS = [
  [/жил|квартир|аренд|дом/, /аренд|квартплат|жкх|коммунал|ипотек|интернет|электричеств|газ|вода/],
  [/ед|продукт|питан/, /продукт|еда|кофе|обед|ужин|завтрак|ресторан|кафе|пекарн|доставк|магнит|пятерочк|перекрест|вкусвилл|лавк|самокат|пицц|суши|шаурм|столов|фастфуд|макдо|бургер/],
  [/транспорт|авто|машин/, /такси|метро|бенз|автобус|проезд|парков|каршер|электричк|топлив|азс|трамва|самолет|поезд/],
  [/развлеч|отдых|досуг/, /кино|игр|бар|концерт|подписк|театр|клуб|steam|netflix|музык|кальян|боулинг/],
  [/здоров|медиц|спорт/, /аптек|врач|лекарств|стомат|анализ|спорт|зал|фитнес|клиник|массаж|витамин/]
];
const INCOME_WORDS = /зарплат|зп\b|аванс|доход|поступ|подработ|кэшбэк|кешбэк|премия|перевод от/i;
const SAVINGS = /подушк|накоп|сбереж|резерв|копил/;

// ---------- storage ----------
// txs: { id, type: income|expense|transfer, amount, envelopeId, fromEnvelopeId, note, createdAt, moves: [[envelopeId, signedAmount]] }
function fresh() {
  const envelopes = DEFAULT_ENVELOPES.map((e, i) => ({ id: i + 1, ...e, sort: i, archived: false }));
  return { v: 1, nextId: envelopes.length + 1, paydays: [1], envelopes, txs: [] };
}

function valid(d) {
  return d && d.v === 1 && Array.isArray(d.envelopes) && Array.isArray(d.txs) && Array.isArray(d.paydays) && Number.isInteger(d.nextId);
}

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (valid(d)) return d;
  } catch {}
  return fresh();
}

let db = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    throw new UserError('Не удалось сохранить: память телефона для приложения переполнена');
  }
}

// Mutations work on a copy and only replace the data once saving succeeded.
function mutate(fn) {
  const before = db;
  db = structuredClone(db);
  try {
    const r = fn();
    save();
    return r;
  } catch (err) {
    db = before;
    throw err;
  }
}

// ---------- helpers ----------
const toAmount = (v) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n <= 0) throw new UserError('Введите сумму больше нуля');
  if (n > 1e9) throw new UserError('Слишком большая сумма');
  return n;
};
const cleanText = (s, max = 120) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const parsePaydays = (s) => String(s ?? '').split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= 31);
const active = () => db.envelopes.filter((e) => !e.archived).sort((a, b) => a.sort - b.sort || a.id - b.id);
const nameOf = (id) => db.envelopes.find((e) => e.id === id)?.name ?? null;
const balanceOf = (id) => db.txs.reduce((s, t) => s + t.moves.reduce((a, [e, v]) => (e === id ? a + v : a), 0), 0);
const days = (n) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function own(id) {
  const e = db.envelopes.find((x) => x.id === Number(id) && !x.archived);
  if (!e) throw new UserError('Конверт не найден');
  return e;
}

function addTx(type, amount, envelopeId, fromEnvelopeId, note, moves) {
  const t = { id: db.nextId++, type, amount, envelopeId, fromEnvelopeId, note, createdAt: Date.now(), moves };
  db.txs.push(t);
  return t;
}

// ---------- reads ----------
export function getEnvelopes(now = Date.now()) {
  const ms = monthStart(new Date(now));
  const bal = new Map();
  const planned = new Map();
  const spent = new Map();
  const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
  for (const t of db.txs) {
    for (const [e, v] of t.moves) {
      add(bal, e, v);
      if (t.type === 'income' && t.createdAt >= ms) add(planned, e, v);
    }
    if (t.type === 'expense' && t.createdAt >= ms && t.envelopeId != null) add(spent, t.envelopeId, t.amount);
  }
  return active().map((e) => {
    const p = planned.get(e.id) || 0;
    return {
      id: e.id,
      name: e.name,
      color: e.color,
      kind: e.kind,
      value: e.value,
      balance: bal.get(e.id) || 0,
      planned: p,
      spent: spent.get(e.id) || 0,
      fixedNeed: e.kind === 'fixed' ? Math.max(0, e.value - p) : 0
    };
  });
}

export function state() {
  const envelopes = getEnvelopes();
  const ms = monthStart();
  let income = 0, spent = 0, mIncome = 0, mSpent = 0;
  for (const t of db.txs) {
    if (t.type === 'income') {
      income += t.amount;
      if (t.createdAt >= ms) mIncome += t.amount;
    } else if (t.type === 'expense') {
      spent += t.amount;
      if (t.createdAt >= ms) mSpent += t.amount;
    }
  }
  const sorted = [...db.txs].sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
  const history = sorted.slice(0, 30).map((t) => ({
    id: t.id,
    type: t.type,
    amount: t.amount,
    note: t.note,
    createdAt: t.createdAt,
    envelope: nameOf(t.envelopeId),
    fromEnvelope: nameOf(t.fromEnvelopeId),
    parts: t.moves.filter(([, v]) => v > 0).length
  }));
  const balance = income - spent;
  return {
    envelopes,
    balance,
    free: balance - envelopes.reduce((s, e) => s + e.balance, 0),
    month: { income: mIncome, spent: mSpent },
    paydays: db.paydays,
    daysLeft: daysUntilPayday(db.paydays),
    history,
    lastIncomes: [...new Set(sorted.filter((t) => t.type === 'income').map((t) => t.amount))].slice(0, 3),
    lastExpenseEnvelope: sorted.find((t) => t.type === 'expense')?.envelopeId ?? null,
    leaksCount: findLeaks().filter((l) => l.level !== 'info').length,
    hasData: db.txs.length > 0
  };
}

export function envelopeDetail(id) {
  const envelope = getEnvelopes().find((e) => e.id === Number(id));
  if (!envelope) throw new UserError('Конверт не найден');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayIndex = (today.getDay() + 6) % 7;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - todayIndex);
  const week = [0, 0, 0, 0, 0, 0, 0];
  const ops = [];
  for (const t of db.txs) {
    if (t.type === 'expense' && t.envelopeId === envelope.id && t.createdAt >= weekStart.getTime()) {
      week[(new Date(t.createdAt).getDay() + 6) % 7] += t.amount;
    }
    const amount = t.moves.reduce((a, [e, v]) => (e === envelope.id ? a + v : a), 0);
    if (amount) ops.push({ id: t.id, type: t.type, note: t.note, createdAt: t.createdAt, amount });
  }
  ops.sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
  return { envelope, daysLeft: daysUntilPayday(db.paydays), week, todayIndex, ops: ops.slice(0, 40) };
}

// ---------- writes ----------
export function addIncome({ amount, source }) {
  const a = toAmount(amount);
  const title = cleanText(source, 40) || 'Поступление';
  const envs = getEnvelopes();
  const d = distribute(a, envs);
  return mutate(() => {
    const moves = envs.filter((e) => d.byId[e.id] > 0).map((e) => [e.id, d.byId[e.id]]);
    const t = addTx('income', a, null, null, title, moves);
    return { id: t.id, amount: a, title, rows: envs.map((e) => ({ name: e.name, amount: d.byId[e.id] || 0 })), free: d.free, short: d.short, shortBy: d.shortBy };
  });
}

// envelopeId null / 'free' = paid from unallocated money.
// coverFrom: envelope id (or 'free') to top the target envelope up from if it lacks money.
export function addExpense({ amount, note, envelopeId, coverFrom }) {
  const a = toAmount(amount);
  const text = cleanText(note);
  return mutate(() => {
    const env = envelopeId == null || envelopeId === 'free' ? null : own(envelopeId);
    let covered = 0;
    if (env && coverFrom != null) {
      const donor = coverFrom === 'free' ? null : own(coverFrom);
      if (donor?.id === env.id) throw new UserError('Нельзя перекинуть из того же конверта');
      const need = a - balanceOf(env.id);
      if (need > 0) {
        const moves = donor ? [[donor.id, -need], [env.id, need]] : [[env.id, need]];
        addTx('transfer', need, env.id, donor?.id ?? null, 'Покрытие расхода', moves);
        covered = need;
      }
    }
    const t = addTx('expense', a, env?.id ?? null, null, text, env ? [[env.id, -a]] : []);
    return { id: t.id, amount: a, note: text, envelope: env?.name ?? null, envelopeId: env?.id ?? null, balance: env ? balanceOf(env.id) : null, covered };
  });
}

export function deleteTx(id) {
  return mutate(() => {
    const i = db.txs.findIndex((t) => t.id === Number(id));
    if (i < 0) throw new UserError('Операция не найдена');
    db.txs.splice(i, 1);
    return { ok: true };
  });
}

export function savePlan({ envelopes, paydays }) {
  if (!Array.isArray(envelopes) || envelopes.length === 0) throw new UserError('Нужен хотя бы один конверт');
  if (envelopes.length > 30) throw new UserError('Слишком много конвертов');
  const clean = envelopes.map((e, i) => {
    const name = cleanText(e.name, 40);
    if (!name) throw new UserError('У каждого конверта должно быть название');
    const kind = e.kind === 'fixed' ? 'fixed' : 'pct';
    const value = Math.round(Number(e.value));
    if (!Number.isFinite(value) || value < 0 || value > 1e9) throw new UserError(`Проверьте сумму в «${name}»`);
    if (kind === 'pct' && value > 100) throw new UserError(`Процент в «${name}» больше 100`);
    const color = /^#[0-9a-f]{6}$/i.test(e.color) ? e.color : PALETTE[i % PALETTE.length];
    return { id: e.id ? Number(e.id) : null, name, kind, value, color, sort: i };
  });
  const pctTotal = clean.filter((e) => e.kind === 'pct').reduce((s, e) => s + e.value, 0);
  if (pctTotal > 100) throw new UserError(`Проценты в сумме ${pctTotal}% — должно быть не больше 100%`);
  const pd = [...new Set(parsePaydays(paydays))].sort((a, b) => a - b);
  if (!pd.length) throw new UserError('Укажите хотя бы один день поступления (1–31)');

  return mutate(() => {
    const before = active();
    const kept = new Set();
    for (const e of clean) {
      const existing = e.id && db.envelopes.find((x) => x.id === e.id && !x.archived);
      if (existing) {
        Object.assign(existing, { name: e.name, color: e.color, kind: e.kind, value: e.value, sort: e.sort });
        kept.add(existing.id);
      } else {
        db.envelopes.push({ id: db.nextId++, name: e.name, color: e.color, kind: e.kind, value: e.value, sort: e.sort, archived: false });
      }
    }
    for (const e of before) if (!kept.has(e.id)) e.archived = true;
    db.paydays = pd;
    return { ok: true };
  });
}

// ---------- quick entry ("кофе 250", "+72000 зарплата", "5к ремонт") ----------
export function parseQuick(text) {
  const t = String(text).trim();
  const m = t.match(/(?:^|\s)([+−-])?(\d{1,3}(?:[  ]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s*(к|k|тыс\.?)?\s*(?:₽|р\.?|руб\.?)?(?=\s|$)/i);
  if (!m) return null;
  let amount = Number(m[2].replace(/[  ]/g, '') + (m[3] ? '.' + m[3] : ''));
  if (m[4]) amount *= 1000;
  amount = Math.round(amount);
  if (!amount) return null;
  const note = (t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length)).replace(/\s+/g, ' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '');
  return { amount, note, income: m[1] === '+' || INCOME_WORDS.test(note) };
}

export function guessEnvelope(note) {
  const envs = active();
  if (!envs.length) return null;
  const nn = normalizeNote(note);
  if (nn) {
    const ids = new Set(envs.map((e) => e.id));
    const prev = [...db.txs].reverse().find((t) => t.type === 'expense' && ids.has(t.envelopeId) && normalizeNote(t.note) === nn);
    if (prev) return envs.find((e) => e.id === prev.envelopeId);
    for (const [nameRe, noteRe] of KEYWORDS) {
      if (!noteRe.test(nn)) continue;
      const hit = envs.find((e) => nameRe.test(normalizeNote(e.name)));
      if (hit) return hit;
    }
  }
  return envs.find((e) => /проч|разн/.test(normalizeNote(e.name))) ?? envs.filter((e) => e.kind === 'pct').at(-1) ?? envs[0];
}

export function quickAdd(text) {
  const p = parseQuick(text);
  if (!p) throw new UserError('Не понял сумму. Пример: «кофе 250» или «+50000 зарплата»');
  if (p.income) return { kind: 'income', ...addIncome({ amount: p.amount, source: p.note || 'Поступление' }) };
  const env = guessEnvelope(p.note);
  return { kind: 'expense', ...addExpense({ amount: p.amount, note: p.note, envelopeId: env?.id ?? null }) };
}

// ---------- backup ----------
export function exportData() {
  return JSON.stringify({ ...db, exportedAt: new Date().toISOString() });
}

export function importData(text) {
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    throw new UserError('Это не файл бэкапа Распределителя');
  }
  if (!valid(d)) throw new UserError('Это не файл бэкапа Распределителя');
  delete d.exportedAt;
  const before = db;
  db = d;
  try {
    save();
  } catch (err) {
    db = before;
    throw err;
  }
  return { envelopes: d.envelopes.filter((e) => !e.archived).length, txs: d.txs.length };
}

export function resetAll() {
  db = fresh();
  save();
}

// ---------- leaks: patterns that quietly eat the budget ----------
const LEVEL = { high: 0, mid: 1, info: 2 };

export function findLeaks(now = Date.now()) {
  const leaks = [];
  const envs = getEnvelopes(now);
  const daysLeft = daysUntilPayday(db.paydays, new Date(now));
  const dayOfMonth = new Date(now).getDate();
  const exp30 = db.txs.filter((t) => t.type === 'expense' && t.createdAt >= now - 30 * DAY);
  const cur30 = new Map();
  const prev30 = new Map();
  for (const t of db.txs) {
    if (t.type !== 'expense') continue;
    if (t.createdAt >= now - 30 * DAY) cur30.set(t.envelopeId, (cur30.get(t.envelopeId) || 0) + t.amount);
    else if (t.createdAt >= now - 60 * DAY) prev30.set(t.envelopeId, (prev30.get(t.envelopeId) || 0) + t.amount);
  }

  // 1. Envelope already below zero.
  for (const e of envs) {
    if (e.balance >= 0) continue;
    leaks.push({
      level: 'high',
      title: `«${e.name}» в минусе на ${fmt(-e.balance)}`,
      text: 'Потрачено больше, чем было выделено. Фактически эти деньги взяты из других конвертов.',
      envelopeId: e.id
    });
  }

  // 2. Spending pace runs the envelope dry before payday.
  for (const e of envs) {
    if (e.kind !== 'pct' || e.balance <= 0 || e.spent <= 0 || dayOfMonth < 3) continue;
    const rate = e.spent / dayOfMonth;
    const lasts = Math.floor(e.balance / rate);
    if (lasts >= daysLeft) continue;
    leaks.push({
      level: lasts < daysLeft / 2 ? 'high' : 'mid',
      title: `«${e.name}» закончится через ${days(lasts)}`,
      text: `Темп — ≈ ${fmt(rate)} в день, а до поступления ${days(daysLeft)}. Чтобы дотянуть, держитесь в пределах ${fmt(e.balance / daysLeft)} в день.`,
      envelopeId: e.id
    });
  }

  // 3. Savings used to plug holes; envelopes that keep needing top-ups.
  const raided = new Map();
  const toppedUp = new Map();
  for (const t of db.txs) {
    if (t.type !== 'transfer' || t.createdAt < now - 30 * DAY) continue;
    const from = nameOf(t.fromEnvelopeId);
    if (from && SAVINGS.test(normalizeNote(from))) {
      const r = raided.get(t.fromEnvelopeId) ?? { name: from, sum: 0 };
      r.sum += t.amount;
      raided.set(t.fromEnvelopeId, r);
    }
    const u = toppedUp.get(t.envelopeId) ?? { name: nameOf(t.envelopeId), count: 0, sum: 0 };
    u.count++;
    u.sum += t.amount;
    toppedUp.set(t.envelopeId, u);
  }
  for (const r of raided.values()) {
    leaks.push({
      level: 'high',
      title: `Из «${r.name}» взято ${fmt(r.sum)} за месяц`,
      text: 'Сбережения покрывают текущие траты — значит, какой-то конверт систематически не дотягивает. Пересмотрите проценты в плане.'
    });
  }
  for (const u of toppedUp.values()) {
    if (u.count < 3) continue;
    leaks.push({
      level: 'mid',
      title: `«${u.name}» докрывали ${u.count} ${plural(u.count, 'раз', 'раза', 'раз')}`,
      text: `За 30 дней в него перекинули ${fmt(u.sum)} из других конвертов. Увеличьте его долю в плане, чтобы не брать у остальных.`
    });
  }

  // 4. Small purchases that repeat and add up.
  const groups = new Map();
  for (const t of exp30) {
    const key = normalizeNote(t.note);
    if (!key || t.amount > 1500) continue;
    const g = groups.get(key) ?? { label: t.note.trim(), count: 0, sum: 0 };
    g.count++;
    g.sum += t.amount;
    groups.set(key, g);
  }
  [...groups.values()]
    .filter((g) => g.count >= 3)
    .sort((a, b) => b.sum - a.sum)
    .slice(0, 3)
    .forEach((g) =>
      leaks.push({
        level: g.sum >= 3000 ? 'mid' : 'info',
        title: `«${cap(g.label)}» — ${g.count} ${plural(g.count, 'раз', 'раза', 'раз')} за 30 дней`,
        text: `Мелочь, которая складывается в ${fmt(g.sum)} в месяц — это ≈ ${fmt(g.sum * 12)} в год.`
      })
    );

  // 5. Envelope spending grew sharply versus the previous 30 days.
  for (const e of envs) {
    if (e.kind === 'fixed') continue;
    const c = cur30.get(e.id) || 0;
    const p = prev30.get(e.id) || 0;
    if (p < 1000 || c <= p * 1.3 || c - p < 1000) continue;
    leaks.push({
      level: 'mid',
      title: `«${e.name}»: +${Math.round((c / p - 1) * 100)}% к прошлому месяцу`,
      text: `${fmt(c)} за последние 30 дней против ${fmt(p)} за 30 дней до этого.`,
      envelopeId: e.id
    });
  }

  // 6. Large one-off purchases inside everyday envelopes.
  const income30 = db.txs.filter((t) => t.type === 'income' && t.createdAt >= now - 30 * DAY).reduce((s, t) => s + t.amount, 0);
  const pctIds = new Set(envs.filter((e) => e.kind === 'pct').map((e) => e.id));
  exp30
    .filter((t) => pctIds.has(t.envelopeId) && t.amount >= Math.max(10000, income30 * 0.15))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 2)
    .forEach((t) =>
      leaks.push({
        level: 'info',
        title: `Крупная трата: ${t.note ? `«${t.note}»` : 'без комментария'} — ${fmt(t.amount)}`,
        text: 'Если это плановая покупка — заведите под неё отдельный конверт, чтобы она не съедала текущие расходы.'
      })
    );

  // 7. Spending outside any envelope or without a comment is hard to analyse.
  const outside = exp30.filter((t) => t.envelopeId == null);
  if (outside.length >= 3) {
    leaks.push({
      level: 'info',
      title: `${fmt(outside.reduce((s, t) => s + t.amount, 0))} потрачено мимо конвертов`,
      text: 'Эти траты не учитываются в лимитах. Записывайте их в конкретный конверт.'
    });
  }
  const blank = exp30.filter((t) => !normalizeNote(t.note));
  if (blank.length >= 5) {
    leaks.push({
      level: 'info',
      title: `${blank.length} ${plural(blank.length, 'трата', 'траты', 'трат')} без комментария`,
      text: `На ${fmt(blank.reduce((s, t) => s + t.amount, 0))}. Подписывайте траты — так находятся повторяющиеся мелочи.`
    });
  }

  return leaks.sort((a, b) => LEVEL[a.level] - LEVEL[b.level]);
}

export function spendingSummary(now = Date.now()) {
  const exp = db.txs.filter((t) => t.type === 'expense' && t.createdAt >= now - 30 * DAY);
  const s = exp.reduce((a, t) => a + t.amount, 0);
  return { spent30: s, count30: exp.length, perDay: Math.round(s / 30) };
}
