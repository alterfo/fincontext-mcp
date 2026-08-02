'use strict';

const { demoMeta } = require('./demo');

const STYLE = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background: #0d1117;
  color: #e6edf3;
  line-height: 1.55;
}
main { max-width: 880px; margin: 0 auto; padding: 48px 24px 96px; }
header h1 { font-size: 34px; margin: 0 0 8px; letter-spacing: -0.5px; }
header p.tagline { font-size: 18px; color: #9da7b3; margin: 0 0 24px; }
.badges { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 28px; }
.badge {
  font-size: 12px; padding: 4px 10px; border-radius: 999px;
  background: #161b22; border: 1px solid #30363d; color: #9da7b3;
}
.security {
  border: 1px solid #1f6feb; background: #0d1b30; border-radius: 10px;
  padding: 14px 18px; margin: 0 0 32px; font-size: 15px;
}
.security strong { color: #79c0ff; }
h2 { font-size: 22px; margin: 40px 0 6px; }
p.lede { color: #9da7b3; margin: 0 0 18px; }
.scenario {
  background: #161b22; border: 1px solid #30363d; border-radius: 10px;
  padding: 14px 18px; margin: 0 0 24px; font-size: 15px; color: #c9d1d9;
}
.tools { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
.tool {
  background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 16px;
}
.tool h3 { margin: 0 0 4px; font-size: 16px; }
.tool p { margin: 0 0 12px; font-size: 13px; color: #9da7b3; min-height: 34px; }
button {
  cursor: pointer; font-size: 14px; font-weight: 600; padding: 8px 14px; border-radius: 8px;
  border: 1px solid #238636; background: #238636; color: #fff; width: 100%;
}
button:hover { background: #2ea043; }
button:disabled { opacity: 0.6; cursor: default; }
#output {
  margin-top: 28px; min-height: 40px;
}
.result {
  background: #161b22; border: 1px solid #30363d; border-radius: 10px;
  padding: 18px 20px; margin-top: 16px;
}
.result h3 { margin: 0 0 10px; font-size: 17px; }
.metric { font-size: 26px; font-weight: 700; color: #79c0ff; }
.metric small { font-size: 14px; color: #9da7b3; font-weight: 400; }
.pill {
  display: inline-block; font-size: 12px; padding: 2px 8px; border-radius: 999px;
  border: 1px solid #30363d; margin-right: 6px;
}
.pill.ok { color: #3fb950; border-color: #238636; }
.pill.warn { color: #d29922; border-color: #9e6a03; }
.pill.bad { color: #f85149; border-color: #da3633; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #21262d; }
th { color: #9da7b3; font-weight: 600; }
tr.gap td { color: #f85149; font-weight: 600; }
ul.ex { margin: 12px 0 0; padding: 0; list-style: none; }
ul.ex li { padding: 8px 0; border-bottom: 1px solid #21262d; font-size: 13px; }
ul.ex li:last-child { border-bottom: 0; }
.ex-type { font-weight: 600; color: #d29922; }
pre {
  background: #0d1117; border: 1px solid #21262d; border-radius: 8px;
  padding: 12px; overflow-x: auto; font-size: 12px; color: #9da7b3; margin-top: 12px;
}
.err { color: #f85149; }
footer { margin-top: 56px; color: #6e7681; font-size: 13px; }
footer a { color: #58a6ff; }
`;

const SCRIPT = `
const RUB = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 });
function rub(kopecks) { return RUB.format((kopecks || 0) / 100); }
function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

function pill(kind, text) { return '<span class="pill ' + kind + '">' + esc(text) + '</span>'; }

function renderCash(r) {
  return '<div class="metric">' + rub(r.total.amount) + ' <small>' + esc(r.total.currency) + '</small></div>' +
    '<div>Остаток на счёте на ' + esc((r.as_of || '').slice(0, 10)) + '</div>';
}

function renderPayment(r) {
  const kind = r.status === 'found' ? 'ok' : (r.status === 'pending' ? 'warn' : 'bad');
  const top = (r.matches && r.matches[0]) || null;
  let html = pill(kind, r.status) + '<div style="margin-top:10px">' + esc(r.explanation) + '</div>';
  if (top) {
    const tx = top.transaction;
    html += '<table><tr><th>Документ</th><th>Назначение</th><th>Сумма</th><th>Уверенность</th></tr>' +
      '<tr><td>' + esc(tx.doc_number || '—') + '</td><td>' + esc(tx.purpose || '—') + '</td><td>' +
      rub(tx.amount) + '</td><td>' + top.confidence.toFixed(2) + '</td></tr></table>';
  }
  return html;
}

function renderReconcile(r) {
  const s = r.summary;
  let html = pill('ok', s.matched + ' совпало') + pill('warn', s.partial + ' частичных') +
    pill('bad', (s.unmatched_bank + s.unmatched_ledger) + ' расхождений');
  html += '<ul class="ex">';
  for (const e of r.exceptions) {
    html += '<li><span class="ex-type">' + esc(e.type) + '</span> — ' + esc(e.suggestion || '') + '</li>';
  }
  html += '</ul>';
  return html;
}

function renderForecast(r) {
  const g = r.gap;
  let html;
  if (g.will_occur) {
    html = pill('bad', 'кассовый разрыв') + '<div style="margin-top:10px">Первый разрыв ' +
      esc(g.first_gap_date) + ', дефицит <strong>' + rub(g.deficit_amount) + '</strong>.</div>';
  } else {
    html = pill('ok', 'разрыва нет') + '<div style="margin-top:10px">Минимальный остаток ' + rub(g.min_balance) + '.</div>';
  }
  html += '<table><tr><th>Дата</th><th>Приток</th><th>Отток</th><th>Прогноз остатка</th></tr>';
  for (const d of r.daily) {
    if (d.inflows === 0 && d.outflows === 0) continue;
    const cls = d.projected_balance < 0 ? ' class="gap"' : '';
    html += '<tr' + cls + '><td>' + esc(d.date) + '</td><td>' + (d.inflows ? rub(d.inflows) : '—') +
      '</td><td>' + (d.outflows ? rub(d.outflows) : '—') + '</td><td>' + rub(d.projected_balance) + '</td></tr>';
  }
  html += '</table>';
  return html;
}

const RENDER = {
  get_cash_position: renderCash,
  check_payment: renderPayment,
  reconcile: renderReconcile,
  cashgap_forecast: renderForecast,
};

const TITLES = {
  get_cash_position: 'Позиция по деньгам',
  check_payment: 'Проверка платежа',
  reconcile: 'Сверка банк ↔ учёт',
  cashgap_forecast: 'Прогноз кассового разрыва',
};

async function run(tool, btn) {
  const out = document.getElementById('output');
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = '…';
  try {
    const res = await fetch('/demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: tool }),
    });
    const data = await res.json();
    const card = document.createElement('div');
    card.className = 'result';
    let body;
    try {
      body = RENDER[tool](data.result);
    } catch (e) {
      body = '<div class="err">' + esc(e.message) + '</div>';
    }
    card.innerHTML = '<h3>' + esc(TITLES[tool] || tool) + '</h3>' + body +
      '<pre>' + esc(JSON.stringify(data.result, null, 2)) + '</pre>';
    out.insertBefore(card, out.firstChild);
  } catch (e) {
    const card = document.createElement('div');
    card.className = 'result';
    card.innerHTML = '<div class="err">' + esc(e.message) + '</div>';
    out.insertBefore(card, out.firstChild);
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

document.addEventListener('click', function (ev) {
  const btn = ev.target.closest('button[data-tool]');
  if (btn) run(btn.getAttribute('data-tool'), btn);
});
`;

const TOOL_CARDS = [
  {
    tool: 'get_cash_position',
    title: 'Позиция по деньгам',
    desc: 'Сколько денег на счетах прямо сейчас, с учётом свежести данных.',
    button: 'Показать остаток',
  },
  {
    tool: 'check_payment',
    title: 'Проверка платежа',
    desc: 'Прошёл ли конкретный платёж — по номеру документа и сумме.',
    button: 'Проверить платёж',
  },
  {
    tool: 'reconcile',
    title: 'Сверка банк ↔ учёт',
    desc: 'Сопоставление выписки банка с проводками учёта, список расхождений.',
    button: 'Сверить',
  },
  {
    tool: 'cashgap_forecast',
    title: 'Прогноз кассового разрыва',
    desc: 'Когда денег не хватит и на сколько, по плановым поступлениям и выплатам.',
    button: 'Спрогнозировать',
  },
];

function toolCard(card) {
  return (
    '<div class="tool">' +
    '<h3>' + card.title + '</h3>' +
    '<p>' + card.desc + '</p>' +
    '<button data-tool="' + card.tool + '">' + card.button + '</button>' +
    '</div>'
  );
}

function landingHtml() {
  const meta = demoMeta();
  const cards = TOOL_CARDS.map(toolCard).join('\n');
  return (
    '<!doctype html>\n' +
    '<html lang="ru">\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>FinContext MCP — финансовый контекст для AI-агента</title>\n' +
    '<style>' + STYLE + '</style>\n' +
    '</head>\n' +
    '<body>\n' +
    '<main>\n' +
    '<header>\n' +
    '<h1>FinContext MCP</h1>\n' +
    '<p class="tagline">Нейтральный self-hosted MCP-сервер: единая финансовая картина малого бизнеса — банки и учёт — для AI-агента.</p>\n' +
    '<div class="badges">' +
    '<span class="badge">Open-core</span>' +
    '<span class="badge">Self-hosted</span>' +
    '<span class="badge">Нейтральный к банкам</span>' +
    '<span class="badge">Apache-2.0</span>' +
    '</div>\n' +
    '</header>\n' +
    '<div class="security"><strong>Токены остаются в вашем облаке.</strong> ' +
    'Сервер разворачивается в вашем Yandex Cloud, ключи банка и учёта живут в вашем Lockbox — ' +
    'наружу они не уходят, посредника нет.</div>\n' +
    '<h2>Живое демо</h2>\n' +
    '<p class="lede">Четыре инструмента на замороженных данных — реальные токены не нужны.</p>\n' +
    '<div class="scenario">Сценарий: <strong>' + meta.scenario + '</strong>. ' +
    'Деньги уходят в минус на выплате зарплаты до прихода оптовой оплаты.</div>\n' +
    '<div class="tools">\n' + cards + '\n</div>\n' +
    '<div id="output"></div>\n' +
    '<footer>\n' +
    'Инструменты вызываются на фикстуре <code>src/demo-data.json</code>. ' +
    'Развёртывание и токены — см. <a href="https://github.com/">docs/SETUP.md</a>.\n' +
    '</footer>\n' +
    '</main>\n' +
    '<script>' + SCRIPT + '</script>\n' +
    '</body>\n' +
    '</html>\n'
  );
}

module.exports = { landingHtml };
