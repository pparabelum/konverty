import { distribute, fmt, plural } from './shared.js';
import * as store from './store.js';

const app = document.getElementById('app');
const SAVINGS = /подушк|накоп|сбереж|резерв|копил/i;
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

let S = null; // snapshot from store.state()
let current = { name: 'main', params: {} };
const stack = [];

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const k = (n) => (Math.abs(n) >= 1000 ? (Math.round(n / 100) / 10).toLocaleString('ru-RU') + 'к' : String(Math.round(n)));
const pct = (part, whole) => (whole > 0 ? Math.max(0, Math.min(100, Math.round((part / whole) * 100))) : 0) + '%';
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const digits = (v) => Number(String(v).replace(/\D/g, '').slice(0, 9)) || 0;
const days = (n) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;
const refresh = () => (S = store.state());
const prefs = {
  get: (key) => {
    try {
      return localStorage.getItem('raspredelitel:pref:' + key);
    } catch {
      return null;
    }
  },
  set: (key, v) => {
    try {
      localStorage.setItem('raspredelitel:pref:' + key, v);
    } catch {}
  }
};

function when(ts) {
  const d = new Date(ts);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (diff === 0) return `сегодня, ${time}`;
  if (diff === 1) return `вчера, ${time}`;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

let toastTimer;
function toast(text, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.className = 'show' + (isError ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 2600);
}

// Runs a store write, then refreshes and reports; returns false when it failed.
function act(fn, okText) {
  try {
    const r = fn();
    refresh();
    if (okText) toast(typeof okText === 'function' ? okText(r) : okText);
    return r ?? true;
  } catch (err) {
    toast(err instanceof store.UserError ? err.message : 'Что-то пошло не так', true);
    if (!(err instanceof store.UserError)) console.error(err);
    return false;
  }
}

// ---------- navigation ----------
function go(name, params = {}) {
  stack.push(current);
  current = { name, params };
  render();
}
function back() {
  current = stack.pop() || { name: 'main', params: {} };
  render();
}
function tab(name) {
  stack.length = 0;
  current = { name, params: {} };
  render();
}
function render() {
  screens[current.name](app, current.params);
  window.scrollTo(0, 0);
}

// Shared click handling: data-go="screen" data-id="…", data-back, data-tab
app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-go],[data-back],[data-tab]');
  if (!el) return;
  e.preventDefault();
  if (el.dataset.back !== undefined) return back();
  if (el.dataset.tab) return tab(el.dataset.tab);
  go(el.dataset.go, el.dataset.id ? { id: Number(el.dataset.id) } : {});
});

// ---------- icons ----------
const svg = (body, size = 22, sw = 1.8) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const I = {
  back: svg('<path d="M15 5l-7 7 7 7"></path>', 18),
  plus: svg('<path d="M12 5v14M5 12h14"></path>', 16, 2.2),
  minus: svg('<path d="M5 12h14"></path>', 16, 2.2),
  close: svg('<path d="M6 6l12 12M18 6L6 18"></path>', 16, 2),
  check: svg('<path d="M5 12l4 4 10-10"></path>', 14, 3),
  send: svg('<path d="M5 12h14M13 6l6 6-6 6"></path>', 18, 2.2),
  share: svg('<path d="M12 3v12M8 7l4-4 4 4"></path><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"></path>', 18),
  addHome: svg('<rect x="4" y="4" width="16" height="16" rx="4"></rect><path d="M12 8v8M8 12h8"></path>', 18),
  leak: svg('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"></path><path d="M12 18a3 3 0 0 1-3-3"></path>', 20, 1.6),
  grid: svg('<rect x="3" y="3" width="7" height="7" rx="2"></rect><rect x="14" y="3" width="7" height="7" rx="2"></rect><rect x="3" y="14" width="7" height="7" rx="2"></rect><rect x="14" y="14" width="7" height="7" rx="2"></rect>'),
  income: svg('<circle cx="12" cy="12" r="9"></circle><path d="M12 8v8M8 12h8"></path>'),
  drop: svg('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"></path>'),
  plan: svg('<path d="M4 6h16M4 12h10M4 18h6"></path>'),
  nfc: svg('<path d="M8.5 7.5a6 6 0 0 1 0 9M12 5a9.5 9.5 0 0 1 0 14M5 10a2.5 2.5 0 0 1 0 4"></path>', 22, 1.6),
  chip: '<svg width="40" height="30" viewBox="0 0 40 30" fill="none" stroke="#5A5F67" stroke-width="1.2" aria-hidden="true"><rect x="0.6" y="0.6" width="38.8" height="28.8" rx="6"></rect><path d="M0.6 10h12M0.6 20h12M27.4 10h12M27.4 20h12M12.6 0.6v28.8M27.4 0.6v28.8"></path></svg>'
};

const header = (title, extra = '') =>
  `<header class="bar-head"><button class="icon-btn" data-back aria-label="Назад">${I.back}</button>${extra || `<h1 class="h1s grow">${esc(title)}</h1>`}</header>`;

function nav(active) {
  const items = [
    ['main', 'Конверты', I.grid],
    ['income', 'Поступление', I.income],
    ['leaks', 'Утечки', I.drop],
    ['plan', 'План', I.plan]
  ];
  return `<nav class="tabs" aria-label="Основная навигация"><div>${items
    .map(([id, label, icon]) => `<button data-tab="${id}" ${id === active ? 'aria-current="page"' : ''}>${icon}${label}</button>`)
    .join('')}</div></nav>`;
}

// iPhone: Safari has no install prompt, so explain the Share → "На экран «Домой»" path once.
function installHint() {
  if (isStandalone || prefs.get('hideInstall')) return '';
  return `
  <section class="panel" id="install">
    <div class="between" style="align-items:center"><span class="h2">Установите на экран «Домой»</span><button class="del" id="hideInstall" aria-label="Скрыть подсказку">${I.close}</button></div>
    <p class="note muted">В Safari нажмите <b class="inline-icon">${I.share}</b> «Поделиться», затем <b class="inline-icon">${I.addHome}</b> «На экран «Домой»». Приложение откроется на весь экран и будет работать без интернета.</p>
    <p class="xs warn">Записи хранятся отдельно в Safari и в установленном приложении — начните вести учёт уже в установленном.</p>
  </section>`;
}

// ---------- screens ----------
const screens = {};

screens.main = (root) => {
  const s = S;
  const month = cap(new Date().toLocaleString('ru-RU', { month: 'long' }));
  const envs = s.envelopes
    .map(
      (e) => `
      <button class="item" data-go="envelope" data-id="${e.id}">
        <div class="row">
          <span class="swatch" style="background:${e.color}"></span>
          <span class="name">${esc(e.name)}</span>
          <span class="val ${e.balance < 0 ? 'neg' : ''}">${e.balance < 0 ? '−' : ''}${fmt(Math.abs(e.balance))}</span>
          <span class="of">/ ${k(e.kind === 'fixed' ? e.value : e.planned)}</span>
        </div>
        <div class="thin indent"><div style="background:${e.color};width:${pct(e.balance, Math.max(e.planned, e.balance))}"></div></div>
      </button>`
    )
    .join('');
  const free = s.free
    ? `<div class="item"><div class="row"><span class="swatch" style="background:var(--dim)"></span><span class="name">Не распределено</span><span class="val">${fmt(s.free)}</span><span class="of"></span></div></div>`
    : '';
  const history = s.history.length
    ? s.history.map(historyItem).join('')
    : '<p class="empty">Пока пусто. Запишите первое поступление — оно само разложится по конвертам.</p>';

  root.innerHTML = `
  <div class="screen with-nav">
    <header class="top">
      <div class="col"><span class="sm muted">${month}</span><h1 class="h1">Конверты</h1></div>
      <button class="icon-btn" data-tab="leaks" aria-label="Утечки${s.leaksCount ? ': есть важные' : ''}">${I.leak}${s.leaksCount ? '<span class="dot"></span>' : ''}</button>
    </header>

    ${installHint()}

    <section class="stack" style="gap:16px">
      <div class="bank">
        <div class="between" style="align-items:center"><span class="sm muted" style="font-weight:600">Основная карта</span><span class="muted">${I.nfc}</span></div>
        <div class="stack">${I.chip}<span class="bank-num" aria-label="Номер карты скрыт">•••• •••• •••• ••••</span></div>
        <div class="between" style="align-items:flex-end">
          <div class="col"><span class="xs muted">Осталось</span><span class="bank-sum ${s.balance < 0 ? 'neg' : ''}">${fmt(s.balance)}</span></div>
          <span class="xs muted" style="font-weight:600">из ${fmt(s.month.income)}</span>
        </div>
      </div>
      <div class="stack" style="gap:8px">
        <div class="track"><div style="width:${pct(s.month.spent, s.month.income)}"></div></div>
        <div class="between xs muted"><span>Потрачено ${fmt(s.month.spent)}</span><span>${days(s.daysLeft)} до поступления</span></div>
      </div>
      <div class="grid2">
        <button class="btn accent" data-go="income">${I.plus}Поступление</button>
        <button class="btn" data-go="expense">${I.minus}Расход</button>
      </div>
      <form class="quick" id="quick" autocomplete="off">
        <label for="q" class="visually-hidden">Быстрая запись</label>
        <input id="q" class="field" type="text" enterkeyhint="send" placeholder="кофе 250 · +50000 зп">
        <button class="icon-btn quick-send" aria-label="Записать">${I.send}</button>
      </form>
    </section>

    <section class="list">
      <div class="between list-head"><h2 class="h2">Конверты</h2><button class="link" data-tab="plan">Изменить план</button></div>
      ${envs}${free}
    </section>

    <section class="list">
      <h2 class="h2 list-head">История</h2>
      ${history}
    </section>
  </div>
  ${nav('main')}`;

  root.querySelectorAll('[data-tx]').forEach((el) => (el.onclick = () => removeTx(Number(el.dataset.tx), el.dataset.label)));
  root.querySelector('#hideInstall')?.addEventListener('click', () => {
    prefs.set('hideInstall', '1');
    root.querySelector('#install').remove();
  });
  root.querySelector('#quick').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = root.querySelector('#q');
    if (!input.value.trim()) return input.focus();
    const r = act(() => store.quickAdd(input.value), (r) =>
      r.kind === 'income'
        ? `+${fmt(r.amount)} разложено по конвертам`
        : `−${fmt(r.amount)} · ${r.envelope ?? 'без конверта'}${r.balance != null ? ` · осталось ${fmt(r.balance)}` : ''}`
    );
    if (r) render();
  });
};

function historyItem(h) {
  let title, sub, sum, cls = '';
  if (h.type === 'income') {
    title = h.note || 'Поступление';
    sub = `Распределено по ${h.parts} ${plural(h.parts, 'конверту', 'конвертам', 'конвертам')} · ${when(h.createdAt)}`;
    sum = '+' + fmt(h.amount);
    cls = 'plus';
  } else if (h.type === 'transfer') {
    title = 'Перенос';
    sub = `${h.fromEnvelope ?? 'Не распределено'} → ${h.envelope} · ${when(h.createdAt)}`;
    sum = fmt(h.amount);
    cls = 'muted';
  } else {
    title = h.note || h.envelope || 'Расход';
    sub = `${h.envelope ?? 'Без конверта'} · ${when(h.createdAt)}`;
    sum = '−' + fmt(h.amount);
  }
  return `
  <button class="item op" data-tx="${h.id}" data-label="${esc(title + ' ' + sum)}" aria-label="${esc(title)}, ${esc(sum)}. Нажмите, чтобы удалить">
    <div class="col grow"><span class="title">${esc(title)}</span><span class="xs muted">${esc(sub)}</span></div>
    <span class="val ${cls}">${sum}</span>
  </button>`;
}

function removeTx(id, label) {
  if (!window.confirm(`Удалить операцию «${label}»? Деньги вернутся в конверты.`)) return;
  if (act(() => store.deleteTx(id), 'Удалено')) render();
}

screens.income = (root) => {
  let amount = 0;
  let source = 'Зарплата';
  const chipValues = [...new Set([...S.lastIncomes, 25000, 50000, 72000, 100000])].slice(0, 4);
  const sources = ['Зарплата', 'Аванс', 'Подработка', 'Другое'];

  root.innerHTML = `
  <div class="screen">
    ${header('Поступление')}
    <section class="stack">
      <label for="amt" class="sm muted">Сколько пришло на карту</label>
      <div class="amount"><input id="amt" type="text" inputmode="numeric" autocomplete="off" placeholder="0"><span class="cur">₽</span></div>
      <div class="chips" id="chips">${chipValues.map((n) => `<button class="chip" data-v="${n}" aria-pressed="false">${n.toLocaleString('ru-RU')}</button>`).join('')}</div>
      <div class="chips" id="sources">${sources.map((s) => `<button class="chip" data-s="${s}" aria-pressed="${s === source}">${s}</button>`).join('')}</div>
    </section>
    <section class="list">
      <div class="between list-head"><h2 class="h2">Распределение</h2><button class="link" data-go="plan">Правила</button></div>
      <div id="dist"></div>
    </section>
    <button class="btn accent tall push" id="submit" disabled>Распределить</button>
  </div>`;

  const input = root.querySelector('#amt');
  const submit = root.querySelector('#submit');
  const update = () => {
    const d = distribute(amount, S.envelopes);
    const rows = S.envelopes
      .map((e) => {
        const v = d.byId[e.id] || 0;
        return `
        <div class="item">
          <div class="row">
            <span class="swatch" style="background:${e.color}"></span>
            <span class="name">${esc(e.name)}</span>
            <span class="rule">${e.kind === 'fixed' ? (e.fixedNeed < e.value ? `ещё ${k(e.fixedNeed)}` : 'фикс.') : e.value + '%'}</span>
            <span class="sum">${fmt(v)}</span>
          </div>
          <div class="thin indent"><div style="background:${e.color};width:${pct(v, amount)}"></div></div>
        </div>`;
      })
      .join('');
    const warn = amount && d.short ? `<p class="note warn" style="margin-bottom:8px">На обязательные платежи не хватает ${fmt(d.shortBy)}. Сначала закрываем их, остальные конверты получат 0.</p>` : '';
    const free = d.free ? `<div class="item"><div class="row"><span class="swatch" style="background:var(--dim)"></span><span class="name">Не распределено</span><span class="sum">${fmt(d.free)}</span></div></div>` : '';
    root.querySelector('#dist').innerHTML = warn + rows + free;
    submit.textContent = 'Распределить ' + fmt(amount);
    submit.disabled = !amount;
    root.querySelectorAll('#chips .chip').forEach((c) => c.setAttribute('aria-pressed', String(Number(c.dataset.v) === amount)));
  };

  input.addEventListener('input', () => {
    amount = digits(input.value);
    input.value = amount ? String(amount) : '';
    update();
  });
  root.querySelectorAll('#chips .chip').forEach((c) => (c.onclick = () => {
    amount = Number(c.dataset.v);
    input.value = String(amount);
    update();
  }));
  root.querySelectorAll('#sources .chip').forEach((c) => (c.onclick = () => {
    source = c.dataset.s;
    root.querySelectorAll('#sources .chip').forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
  }));
  submit.onclick = () => {
    if (act(() => store.addIncome({ amount, source }), `+${fmt(amount)} разложено по конвертам`)) tab('main');
  };
  update();
};

screens.expense = (root, params) => {
  const options = S.envelopes.map((e) => ({ id: e.id, name: e.name, color: e.color, balance: e.balance }));
  if (S.free > 0) options.push({ id: 'free', name: 'Не распределено', color: 'var(--dim)', balance: S.free });
  const preferred = params.id ?? S.lastExpenseEnvelope;
  let sel = options.find((o) => o.id === preferred) ?? options.find((o) => o.balance > 0) ?? options[0];
  let amount = 0;
  let cover = false;

  root.innerHTML = `
  <div class="screen">
    ${header('Расход')}
    <section class="stack">
      <label for="exp" class="sm muted">Сколько потратил</label>
      <div class="amount"><span class="sign">−</span><input id="exp" type="text" inputmode="numeric" autocomplete="off" placeholder="0"><span class="cur">₽</span></div>
      <label for="note" class="sm muted">Комментарий</label>
      <input id="note" class="field" type="text" maxlength="120" placeholder="Например: продукты на неделю" autocomplete="off">
    </section>
    <section class="list">
      <h2 class="h2 list-head">Из какого конверта</h2>
      ${options
        .map(
          (o) => `
        <button class="pick" data-env="${o.id}" aria-pressed="${o.id === sel.id}">
          <span class="swatch" style="background:${o.color}"></span>
          <span class="grow" style="font-size:14px;font-weight:600">${esc(o.name)}</span>
          <span class="sm ${o.balance < 0 ? 'neg' : 'muted'}">${fmt(o.balance)}</span>
          <span class="radio"></span>
        </button>`
        )
        .join('')}
    </section>
    <section class="panel" id="after"></section>
    <button class="btn light tall push" id="submit" disabled>Записать расход</button>
  </div>`;

  const input = root.querySelector('#exp');
  const note = root.querySelector('#note');
  const submit = root.querySelector('#submit');
  let donorId = null;

  const donorFor = (need) =>
    options
      .filter((o) => o.id !== sel.id && o.balance >= need)
      .sort((a, b) => Number(SAVINGS.test(a.name)) - Number(SAVINGS.test(b.name)) || b.balance - a.balance)[0];

  const update = () => {
    const after = sel.balance - amount;
    const over = after < 0;
    const donor = over && sel.id !== 'free' ? donorFor(-after) : null;
    if (!donor) cover = false;
    donorId = donor && cover ? donor.id : null;
    let html = `
      <span class="sm muted">Останется в «${esc(sel.name)}»</span>
      <span class="sumbig ${over && !cover ? 'neg' : ''}">${over && !cover ? '−' + fmt(-after) : fmt(Math.max(0, after))}</span>
      <div class="thin"><div style="background:${sel.color};width:${pct(Math.max(0, after), Math.max(sel.balance, 1))}"></div></div>`;
    if (over) {
      html += `<span class="note warn">Не хватает ${fmt(-after)}.${donor ? ` Можно перекинуть из «${esc(donor.name)}» — там ${fmt(donor.balance)}.` : ' Свободных денег в других конвертах нет.'}</span>`;
      if (donor)
        html += `<button class="toggle" id="cover" aria-pressed="${cover}"><span class="box">${cover ? I.check : ''}</span>Перекинуть ${fmt(-after)} из «${esc(donor.name)}»</button>`;
    } else {
      html += `<span class="sm muted">≈ ${fmt(Math.floor(after / S.daysLeft))} в день до следующего поступления</span>`;
    }
    const box = root.querySelector('#after');
    box.innerHTML = html;
    box.querySelector('#cover')?.addEventListener('click', () => {
      cover = !cover;
      update();
    });
    submit.disabled = !amount;
  };

  input.addEventListener('input', () => {
    amount = digits(input.value);
    input.value = amount ? String(amount) : '';
    update();
  });
  root.querySelectorAll('.pick').forEach((b) => (b.onclick = () => {
    sel = options.find((o) => String(o.id) === b.dataset.env);
    cover = false;
    root.querySelectorAll('.pick').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    update();
  }));
  submit.onclick = () => {
    const ok = act(() => store.addExpense({ amount, note: note.value, envelopeId: sel.id, coverFrom: donorId }), `−${fmt(amount)} записано`);
    if (ok) back();
  };
  update();
};

screens.envelope = (root, params) => {
  let d;
  try {
    d = store.envelopeDetail(params.id);
  } catch (err) {
    root.innerHTML = `<div class="screen">${header('Конверт')}<p class="center muted">${esc(err.message)}</p></div>`;
    return;
  }
  const e = d.envelope;
  const today = Math.max(0, Math.floor(e.balance / d.daysLeft));
  const max = Math.max(...d.week, today, 1);
  const labels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const week = d.week
    .map((v, i) => {
      const color = i > d.todayIndex ? 'var(--track)' : v > today ? e.color : v ? 'var(--bar)' : 'var(--track)';
      return `<div class="${i === d.todayIndex ? 'today' : ''}"><div class="b" style="background:${color};height:${Math.max(3, Math.round((v / max) * 96))}px"></div><span>${labels[i]}</span></div>`;
    })
    .join('');
  const ops = d.ops.length
    ? d.ops
        .map((o) => {
          const title = o.type === 'income' ? `Из поступления «${o.note || 'Поступление'}»` : o.type === 'transfer' ? 'Перенос' : o.note || 'Расход';
          return `<div class="item op"><div class="col grow"><span class="title">${esc(title)}</span><span class="xs muted">${when(o.createdAt)}</span></div><span class="val ${o.amount > 0 ? 'plus' : ''}">${o.amount > 0 ? '+' : '−'}${fmt(Math.abs(o.amount))}</span></div>`;
        })
        .join('')
    : '<p class="empty">Операций пока нет.</p>';

  root.innerHTML = `
  <div class="screen">
    ${header('', `<span class="swatch" style="background:${e.color}"></span><h1 class="h1s grow">${esc(e.name)}</h1><span class="sm muted">${e.kind === 'fixed' ? 'фикс. ' + fmt(e.value) : e.value + '% остатка'}</span>`)}
    <section class="stack" style="gap:6px">
      <span class="sm muted">Можно тратить сегодня</span>
      <span class="big ${e.balance < 0 ? 'neg' : ''}">${fmt(today)}</span>
      <span class="sm muted">${e.balance < 0 ? `Конверт в минусе на ${fmt(-e.balance)}` : `Осталось ${fmt(e.balance)} на ${days(d.daysLeft)} до поступления`}</span>
    </section>
    <section class="grid3">
      <div><span class="xs muted">Выделено</span><b>${k(e.planned)}</b></div>
      <div><span class="xs muted">Потрачено</span><b>${k(e.spent)}</b></div>
      <div><span class="xs muted">Осталось</span><b class="${e.balance < 0 ? 'neg' : ''}">${k(e.balance)}</b></div>
    </section>
    <section class="stack">
      <div class="between"><h2 class="h2">Эта неделя</h2><span class="xs muted">лимит ${fmt(today)} в день</span></div>
      <div class="week">${week}</div>
      <div class="legend"><span><i style="background:var(--bar)"></i>в пределах лимита</span><span><i style="background:${e.color}"></i>выше лимита</span></div>
    </section>
    <section class="list"><h2 class="h2 list-head">Операции</h2>${ops}</section>
    <button class="btn tall push" data-go="expense" data-id="${e.id}">${I.minus}Записать расход</button>
  </div>`;
};

screens.plan = (root) => {
  const items = S.envelopes.map((e) => ({ id: e.id, name: e.name, color: e.color, kind: e.kind, value: e.value, balance: e.balance }));
  let paydays = S.paydays.join(', ');

  const draw = (focusKind) => {
    const fixed = items.filter((e) => e.kind === 'fixed');
    const pcts = items.filter((e) => e.kind === 'pct');
    const total = pcts.reduce((s, e) => s + e.value, 0);
    const ok = total === 100;
    const delBtn = (e) => `<button class="del" data-del="${items.indexOf(e)}" aria-label="Удалить: ${esc(e.name)}">${I.close}</button>`;
    root.innerHTML = `
    <div class="screen with-nav">
      <header class="col"><span class="sm muted">Правила распределения</span><h1 class="h1">План</h1></header>
      <p class="lead">Каждое поступление сначала закрывает обязательные платежи (только то, что ещё не оплачено в этом месяце), остаток делится по процентам.</p>

      <section class="list">
        <h2 class="cap list-head">Обязательные в месяц</h2>
        ${fixed
          .map(
            (e) => `
          <div class="plan-row">
            <span class="swatch" style="background:${e.color}"></span>
            <input class="name-input" data-name="${items.indexOf(e)}" value="${esc(e.name)}" aria-label="Название платежа" maxlength="40">
            <label class="money"><input inputmode="numeric" data-fixed="${items.indexOf(e)}" value="${e.value}" aria-label="Сумма: ${esc(e.name)}"><span>₽</span></label>
            ${delBtn(e)}
          </div>`
          )
          .join('')}
        <button class="btn dashed" id="addFixed">${I.plus}Добавить платёж</button>
      </section>

      <section class="list">
        <div class="between list-head" style="align-items:center"><h2 class="cap">Остаток по процентам</h2><span class="badge ${ok ? '' : 'bad'}">${total}%</span></div>
        <div class="stackbar">${pcts.map((e) => `<div style="background:${e.color};width:${e.value}%"></div>`).join('')}</div>
        ${pcts
          .map(
            (e) => `
          <div class="plan-row">
            <span class="swatch" style="background:${e.color}"></span>
            <input class="name-input" data-name="${items.indexOf(e)}" value="${esc(e.name)}" aria-label="Название конверта" maxlength="40">
            <button class="step muted" data-step="${items.indexOf(e)}" data-d="-5" aria-label="Уменьшить: ${esc(e.name)}">${I.minus}</button>
            <span class="pct">${e.value}%</span>
            <button class="step muted" data-step="${items.indexOf(e)}" data-d="5" aria-label="Увеличить: ${esc(e.name)}">${I.plus}</button>
            ${delBtn(e)}
          </div>`
          )
          .join('')}
        ${ok ? '' : `<p class="note warn" style="padding-top:8px">${total > 100 ? `Перебор на ${total - 100}% — уменьшите какой-нибудь конверт.` : `Не распределено ${100 - total}% — они останутся свободными.`}</p>`}
        <button class="btn dashed" id="addPct">${I.plus}Добавить конверт</button>
      </section>

      <section class="stack" style="gap:8px">
        <label for="paydays" class="cap">Дни поступлений</label>
        <input id="paydays" class="field" inputmode="numeric" value="${esc(paydays)}" placeholder="Например: 10, 25">
        <span class="xs muted">Числа месяца через запятую — от них считаются дневные лимиты.</span>
      </section>

      <button class="btn light tall" id="save" ${total > 100 ? 'disabled' : ''}>Сохранить план</button>

      <section class="stack" style="gap:10px">
        <h2 class="cap">Данные</h2>
        <p class="note muted">Все записи хранятся только на этом телефоне. Раз в неделю-две сохраняйте бэкап в «Файлы» или iCloud — если телефон потеряется или приложение удалится, из него всё восстановится.</p>
        <div class="grid2">
          <button class="btn" id="export" aria-label="Сохранить бэкап">${I.share}Сохранить</button>
          <button class="btn" id="import">Восстановить</button>
        </div>
        <input type="file" id="importFile" accept="application/json,.json" hidden>
      </section>
    </div>
    ${nav('plan')}`;

    root.querySelectorAll('[data-name]').forEach((el) => el.addEventListener('input', () => (items[el.dataset.name].name = el.value)));
    root.querySelectorAll('[data-fixed]').forEach((el) =>
      el.addEventListener('input', () => {
        const v = digits(el.value);
        el.value = v ? String(v) : '';
        items[el.dataset.fixed].value = v;
      })
    );
    root.querySelectorAll('[data-step]').forEach((el) => (el.onclick = () => {
      const e = items[el.dataset.step];
      e.value = Math.max(0, Math.min(100, e.value + Number(el.dataset.d)));
      draw();
    }));
    root.querySelectorAll('[data-del]').forEach((el) => (el.onclick = () => {
      const e = items[el.dataset.del];
      const msg = e.balance > 0 ? `Удалить «${e.name}»? ${fmt(e.balance)} из него станут нераспределёнными.` : `Удалить «${e.name}»?`;
      if (!window.confirm(msg)) return;
      items.splice(items.indexOf(e), 1);
      draw();
    }));
    root.querySelector('#paydays').addEventListener('input', (ev) => (paydays = ev.target.value));
    const add = (kind) => {
      items.push({ id: null, name: kind === 'fixed' ? 'Новый платёж' : 'Новый конверт', color: store.PALETTE[items.length % store.PALETTE.length], kind, value: 0, balance: 0 });
      draw(kind);
    };
    root.querySelector('#addFixed').onclick = () => add('fixed');
    root.querySelector('#addPct').onclick = () => add('pct');
    root.querySelector('#save').onclick = () => {
      if (act(() => store.savePlan({ envelopes: items, paydays }), 'План сохранён')) tab('main');
    };
    root.querySelector('#export').onclick = exportBackup;
    root.querySelector('#import').onclick = () => root.querySelector('#importFile').click();
    root.querySelector('#importFile').onchange = (ev) => importBackup(ev.target.files[0]);

    if (focusKind) {
      const idx = items.length - 1;
      root.querySelector(`[data-name="${idx}"]`)?.select();
    }
  };
  draw();
};

async function exportBackup() {
  const name = `raspredelitel-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([store.exportData()], name, { type: 'application/json' });
  // iPhone: the share sheet offers "Сохранить в Файлы" / iCloud / Telegram.
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Бэкап Распределителя' });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function importBackup(file) {
  if (!file) return;
  const text = await file.text();
  if (S.hasData && !window.confirm('Заменить все текущие записи данными из бэкапа?')) return;
  const r = act(() => store.importData(text), (r) => `Восстановлено: ${r.txs} ${plural(r.txs, 'операция', 'операции', 'операций')}`);
  if (r) tab('main');
}

screens.leaks = (root) => {
  const leaks = store.findLeaks();
  const sum = store.spendingSummary();
  const label = { high: 'Важно', mid: 'Обратить внимание', info: 'Совет' };
  const cards = leaks.length
    ? leaks
        .map(
          (l) => `
        <article class="leak ${l.level}">
          <span class="lvl"><i></i>${label[l.level]}</span>
          <h2 class="t">${esc(l.title)}</h2>
          <p class="d">${esc(l.text)}</p>
          ${l.envelopeId ? `<button class="link" style="align-self:flex-start;margin-top:4px" data-go="envelope" data-id="${l.envelopeId}">Открыть конверт</button>` : ''}
        </article>`
        )
        .join('')
    : `<p class="empty">Утечек не найдено. Записывайте траты с комментариями — так анализ находит повторяющиеся мелочи и перерасходы.</p>`;

  root.innerHTML = `
  <div class="screen with-nav">
    <header class="col"><span class="sm muted">Последние 30 дней</span><h1 class="h1">Утечки</h1></header>
    <section class="grid3">
      <div><span class="xs muted">Потрачено</span><b>${k(sum.spent30)}</b></div>
      <div><span class="xs muted">Операций</span><b>${sum.count30}</b></div>
      <div><span class="xs muted">В среднем/день</span><b>${k(sum.perDay)}</b></div>
    </section>
    <section class="stack" style="gap:10px">${cards}</section>
  </div>
  ${nav('leaks')}`;
};

// ---------- boot ----------
try {
  refresh();
  render();
} catch (err) {
  console.error(err);
  app.innerHTML = `<div class="center"><p class="h2">Не удалось загрузить данные</p><p class="sm muted" style="margin-top:8px">${esc(err.message)}</p></div>`;
}

// Ask the browser not to evict our data under storage pressure.
navigator.storage?.persist?.().catch(() => {});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

// Day changes (limits, "today") while the app sits in the background.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const active = document.activeElement;
  if (active && active.tagName === 'INPUT') return;
  refresh();
  if (['main', 'leaks', 'envelope'].includes(current.name)) render();
});
