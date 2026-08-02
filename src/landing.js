'use strict';

const { demoMeta } = require('./demo');

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function embedJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

const STYLE = `
:root {
  color-scheme: dark;
  --bg: #121213;
  --bg-deep: #0d0d0e;
  --surface: #1c1c1e;
  --surface-2: #29292c;
  --border: #29292c;
  --border-2: #3f3f45;
  --text: #ffffff;
  --muted: rgba(255,255,255,0.7);
  --muted-2: rgba(255,255,255,0.4);
  --accent: #ef3124;
  --accent-hover: #ff503e;
  --violet: #6a4dff;
  --blue: #4d8bff;
  --positive: #2fc26e;
  --danger: #f15045;
  --warn: #e58933;
  --r-s: 8px;
  --r-m: 12px;
  --r-l: 16px;
  --r-xl: 20px;
  --pill: 99px;
  --shadow-l: 0 24px 60px -24px rgba(0,0,0,0.7);
  --maxw: 1140px;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
a { color: inherit; text-decoration: none; }
.wrap { max-width: var(--maxw); margin: 0 auto; padding: 0 24px; }

nav {
  position: sticky; top: 0; z-index: 50;
  background: rgba(18,18,19,0.78); backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--border);
}
nav .row { display: flex; align-items: center; justify-content: space-between; height: 68px; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 18px; letter-spacing: -0.3px; }
.brand .dot { width: 22px; height: 22px; border-radius: 7px; background: linear-gradient(135deg, var(--accent), var(--violet)); display: inline-block; }
.nav-links { display: flex; gap: 28px; align-items: center; }
.nav-links a { color: var(--muted); font-size: 15px; }
.nav-links a:hover { color: var(--text); }
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  font-size: 15px; font-weight: 600; padding: 12px 22px; border-radius: var(--r-m);
  border: 1px solid transparent; cursor: pointer; transition: all .16s ease; white-space: nowrap;
}
.btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); transform: translateY(-1px); }
.btn-ghost { background: transparent; color: var(--text); border-color: var(--border-2); }
.btn-ghost:hover { border-color: var(--muted); }
.nav .btn { padding: 10px 18px; }

section { padding: 88px 0; }
.eyebrow {
  display: inline-block; font-size: 13px; font-weight: 600; letter-spacing: 0.4px; text-transform: uppercase;
  color: var(--accent); background: rgba(239,49,36,0.10); border: 1px solid rgba(239,49,36,0.28);
  border-radius: var(--pill); padding: 6px 14px; margin-bottom: 22px;
}
h1 { font-size: clamp(38px, 5.8vw, 62px); line-height: 1.04; letter-spacing: -1.6px; margin: 0 0 22px; font-weight: 800; }
h1 .grad { background: linear-gradient(96deg, var(--accent), var(--violet)); -webkit-background-clip: text; background-clip: text; color: transparent; }
h2 { font-size: clamp(28px, 4vw, 42px); line-height: 1.1; letter-spacing: -1px; margin: 0 0 16px; font-weight: 800; }
h3 { margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -0.2px; }
p { margin: 0; }
.section-head { max-width: 740px; margin: 0 0 52px; }
.section-head p { color: var(--muted); font-size: 18px; margin-top: 10px; }
.center { text-align: center; margin-left: auto; margin-right: auto; }

.hero { position: relative; padding-top: 88px; overflow: hidden; }
.hero::before {
  content: ""; position: absolute; top: -300px; left: 50%; transform: translateX(-50%);
  width: 1000px; height: 760px; pointer-events: none;
  background: radial-gradient(closest-side, rgba(239,49,36,0.16), rgba(106,77,255,0.08) 52%, transparent 72%);
}
.hero-grid { position: relative; display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 56px; align-items: center; }
.hero p.lede { font-size: 20px; color: var(--muted); max-width: 580px; margin-bottom: 30px; }
.hero .trust-line { margin-top: 18px; display: flex; flex-wrap: wrap; gap: 18px; color: var(--muted-2); font-size: 14px; }
.hero .trust-line span { display: inline-flex; align-items: center; gap: 7px; }
.tick { color: var(--positive); }

.lead-form { display: flex; gap: 10px; flex-wrap: wrap; max-width: 480px; }
.lead-form input {
  flex: 1; min-width: 220px; background: var(--surface); border: 1px solid var(--border-2); color: var(--text);
  border-radius: var(--r-m); padding: 13px 15px; font-size: 15px; outline: none; transition: border-color .16s;
}
.lead-form input:focus { border-color: var(--accent); }
.lead-form input::placeholder { color: var(--muted-2); }
.lead-note { margin-top: 12px; font-size: 13px; color: var(--muted-2); }
.lead-status { margin-top: 12px; font-size: 14px; min-height: 20px; }
.lead-status.ok { color: var(--positive); }
.lead-status.err { color: var(--danger); }

.mock {
  background: linear-gradient(180deg, var(--surface-2), var(--surface));
  border: 1px solid var(--border-2); border-radius: var(--r-xl); padding: 20px;
  box-shadow: var(--shadow-l);
}
.mock .bar { display: flex; gap: 6px; margin-bottom: 16px; }
.mock .bar i { width: 11px; height: 11px; border-radius: 50%; background: var(--border-2); display: inline-block; }
.mock .q { font-size: 14px; color: var(--muted); background: var(--bg-deep); border: 1px solid var(--border); border-radius: var(--r-m); padding: 10px 13px; margin-bottom: 14px; }
.mock .q b { color: var(--text); font-weight: 600; }
.mock .a-metric { font-size: 40px; font-weight: 800; letter-spacing: -1px; color: var(--positive); }
.mock .a-sub { color: var(--muted); font-size: 14px; margin-top: 2px; }
.mock .start { margin-top: 16px; display: flex; justify-content: space-between; font-size: 13px; color: var(--muted); padding: 0 12px 8px; }
.mock .rows { display: grid; gap: 7px; }
.mock .rows .r { display: grid; grid-template-columns: 1fr auto auto; gap: 12px; align-items: baseline; font-size: 13px; padding: 9px 12px; background: var(--bg-deep); border: 1px solid var(--border); border-radius: var(--r-s); }
.mock .rows .r .k { color: var(--muted); }
.mock .rows .r .d { font-variant-numeric: tabular-nums; }
.mock .rows .r .d.out { color: var(--danger); }
.mock .rows .r .d.in { color: var(--positive); }
.mock .rows .r .v { font-weight: 700; font-variant-numeric: tabular-nums; min-width: 96px; text-align: right; }
.mock .rows .r.neg .v { color: var(--danger); }
.mock .flag { margin-top: 14px; font-size: 13px; color: var(--warn); background: rgba(229,137,51,0.10); border: 1px solid rgba(229,137,51,0.28); border-radius: var(--r-s); padding: 10px 12px; display: flex; align-items: center; gap: 8px; }

.logos { border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); background: var(--bg-deep); padding: 28px 0; }
.logos .inner { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: center; }
.logos .label { color: var(--muted-2); font-size: 14px; margin-right: 6px; }
.chip { font-size: 14px; font-weight: 600; color: var(--muted); border: 1px solid var(--border-2); background: var(--surface); border-radius: var(--r-m); padding: 8px 14px; }
.chip.soon { color: var(--muted-2); border-style: dashed; }
.chip.soon::after { content: " · скоро"; color: var(--muted-2); font-weight: 400; font-size: 12px; }

.grid-auto { display: grid; grid-template-columns: repeat(auto-fit, minmax(258px, 1fr)); gap: 20px; }
.problem { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-l); padding: 26px; }
.problem .num { font-size: 13px; font-weight: 700; color: var(--accent); letter-spacing: 0.5px; }
.problem h3 { margin: 12px 0 8px; }
.problem p { color: var(--muted); font-size: 15px; }

.features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.feature { position: relative; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-l); padding: 26px; transition: border-color .16s, transform .16s; }
.feature:hover { border-color: var(--border-2); transform: translateY(-2px); }
.feature .ico { width: 46px; height: 46px; border-radius: var(--r-m); background: rgba(239,49,36,0.10); border: 1px solid rgba(239,49,36,0.24); display: flex; align-items: center; justify-content: center; margin-bottom: 18px; }
.feature .ico svg { width: 24px; height: 24px; stroke: var(--accent); fill: none; stroke-width: 1.8; }
.feature h3 { margin-bottom: 8px; }
.feature p { color: var(--muted); font-size: 15px; }
.tag { position: absolute; top: 20px; right: 20px; font-size: 11px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; color: var(--violet); background: rgba(106,77,255,0.12); border: 1px solid rgba(106,77,255,0.32); border-radius: var(--pill); padding: 3px 9px; }

.band { text-align: center; max-width: 760px; margin: 0 auto; }
.band h2 { margin-bottom: 12px; }
.band p { color: var(--muted); font-size: 19px; }

.demo-panel { background: linear-gradient(180deg, var(--surface), var(--bg-deep)); border: 1px solid var(--border-2); border-radius: var(--r-xl); padding: 30px; }
.scenario { background: rgba(77,139,255,0.07); border: 1px solid rgba(77,139,255,0.22); border-radius: var(--r-m); padding: 15px 18px; margin-bottom: 24px; font-size: 15px; color: var(--muted); }
.scenario b { color: var(--blue); }
.demo-grid { display: grid; grid-template-columns: 350px 1fr; gap: 22px; align-items: start; }
.ask-list { display: grid; gap: 10px; }
.ask { text-align: left; width: 100%; background: var(--surface); border: 1px solid var(--border); color: var(--text); border-radius: var(--r-m); padding: 15px 16px; cursor: pointer; transition: all .16s; font: inherit; }
.ask:hover { border-color: var(--accent); background: var(--surface-2); }
.ask.active { border-color: var(--accent); box-shadow: inset 3px 0 0 var(--accent); }
.ask .q { font-size: 15px; font-weight: 600; }
.ask .d { font-size: 13px; color: var(--muted); margin-top: 3px; }
.answer { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-l); padding: 24px; min-height: 288px; }
.answer .empty { color: var(--muted-2); font-size: 15px; display: flex; align-items: center; height: 240px; justify-content: center; text-align: center; }
.answer .title { font-size: 14px; color: var(--muted); margin-bottom: 6px; }
.metric { font-size: 40px; font-weight: 800; letter-spacing: -1px; color: var(--positive); }
.metric small { font-size: 15px; color: var(--muted); font-weight: 500; }
.answer .caption { color: var(--muted); font-size: 14px; margin-top: 4px; }
.pills { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 14px; }
.pill { font-size: 13px; padding: 4px 12px; border-radius: var(--pill); border: 1px solid var(--border-2); font-weight: 600; }
.pill.ok { color: var(--positive); border-color: rgba(47,194,110,0.4); background: rgba(47,194,110,0.08); }
.pill.warn { color: var(--warn); border-color: rgba(229,137,51,0.4); background: rgba(229,137,51,0.08); }
.pill.bad { color: var(--danger); border-color: rgba(241,80,69,0.4); background: rgba(241,80,69,0.08); }
table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 13.5px; }
th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--border); }
th { color: var(--muted); font-weight: 600; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tr.gap td { color: var(--danger); font-weight: 700; }
.exc { list-style: none; margin: 14px 0 0; padding: 0; }
.exc li { padding: 12px 0; border-bottom: 1px solid var(--border); font-size: 14px; }
.exc li:last-child { border-bottom: 0; }
.exc .t { font-weight: 700; margin-right: 8px; }
.exc .t.warn { color: var(--warn); }
.exc .t.bad { color: var(--danger); }
.exc .s { color: var(--muted); }
.raw { margin-top: 16px; }
.raw summary { cursor: pointer; color: var(--muted-2); font-size: 13px; }
.raw pre { background: var(--bg-deep); border: 1px solid var(--border); border-radius: var(--r-s); padding: 12px; overflow-x: auto; font-size: 12px; color: var(--muted); margin-top: 10px; }
.shimmer { color: var(--muted); font-size: 15px; display: flex; align-items: center; gap: 10px; height: 240px; justify-content: center; }
.spin { width: 18px; height: 18px; border: 2px solid var(--border-2); border-top-color: var(--accent); border-radius: 50%; animation: spin .7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.security { background: linear-gradient(135deg, rgba(239,49,36,0.06), rgba(106,77,255,0.06)); border: 1px solid var(--border-2); border-radius: var(--r-xl); padding: 46px; }
.security-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 22px; margin-top: 28px; }
.sec-item { display: flex; gap: 14px; }
.sec-item .ico { flex: none; width: 38px; height: 38px; border-radius: var(--r-m); background: rgba(77,139,255,0.10); border: 1px solid rgba(77,139,255,0.24); display: flex; align-items: center; justify-content: center; }
.sec-item .ico svg { width: 20px; height: 20px; stroke: var(--blue); fill: none; stroke-width: 1.8; }
.sec-item h3 { font-size: 16px; }
.sec-item p { color: var(--muted); font-size: 14px; margin-top: 4px; }

.hero-note { margin-top: 20px; display: flex; gap: 12px; align-items: flex-start; background: var(--surface); border: 1px solid var(--border-2); border-left: 3px solid var(--accent); border-radius: var(--r-m); padding: 14px 16px; font-size: 14px; color: var(--muted); max-width: 560px; }
.hero-note b { color: var(--text); }
.hero-note .lk { color: var(--accent); flex: none; }

.arch { margin: 26px 0 30px; }
.perimeter { position: relative; border: 1.5px dashed var(--accent); border-radius: var(--r-l); padding: 34px 20px 22px; background: rgba(239,49,36,0.04); }
.perimeter .plabel { position: absolute; top: -12px; left: 18px; background: var(--bg); padding: 2px 12px; font-size: 13px; font-weight: 700; color: var(--accent); display: inline-flex; align-items: center; gap: 6px; border: 1px solid rgba(239,49,36,0.35); border-radius: var(--pill); }
.flow { display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; }
.node { background: var(--surface-2); border: 1px solid var(--border-2); border-radius: var(--r-m); padding: 12px 16px; font-size: 14px; font-weight: 600; text-align: center; }
.node small { display: block; font-weight: 400; color: var(--muted); font-size: 12px; margin-top: 2px; }
.node.accent { border-color: var(--accent); box-shadow: 0 0 0 1px rgba(239,49,36,0.25); }
.arrow { color: var(--muted-2); font-size: 20px; }
.external { margin-top: 16px; display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 14px; color: var(--muted); }
.external .x { color: var(--danger); font-weight: 800; }
.external .who { text-decoration: line-through; text-decoration-color: var(--danger); }

.compare { width: 100%; border-collapse: collapse; margin: 8px 0 4px; font-size: 14.5px; overflow: hidden; border-radius: var(--r-m); }
.compare th, .compare td { padding: 13px 16px; text-align: left; border-bottom: 1px solid var(--border); }
.compare thead th { font-size: 13px; text-transform: uppercase; letter-spacing: 0.3px; color: var(--muted); }
.compare thead th:last-child { color: var(--accent); }
.compare td:first-child { color: var(--muted); }
.compare .no { color: var(--danger); }
.compare .yes { color: var(--positive); font-weight: 600; }
.compare-wrap { overflow-x: auto; margin-bottom: 30px; border: 1px solid var(--border); border-radius: var(--r-m); }

.cta { text-align: center; background: var(--surface); border: 1px solid var(--border-2); border-radius: var(--r-xl); padding: 62px 30px; }
.cta h2 { margin-bottom: 12px; }
.cta p { color: var(--muted); font-size: 18px; max-width: 580px; margin: 0 auto 28px; }
.cta .lead-form { margin: 0 auto; justify-content: center; }

footer { border-top: 1px solid var(--border); padding: 40px 0; }
footer .row { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; }
footer .muted { color: var(--muted-2); font-size: 14px; }
footer a.muted:hover { color: var(--muted); }

@media (max-width: 880px) {
  section { padding: 60px 0; }
  .hero-grid { grid-template-columns: 1fr; gap: 40px; }
  .mock { order: 2; }
  .features { grid-template-columns: 1fr; }
  .demo-grid { grid-template-columns: 1fr; }
  .security-grid { grid-template-columns: 1fr; }
  .security { padding: 28px; }
  .nav-links a:not(.btn) { display: none; }
}
`;

const ICON = {
  layers: '<svg viewBox="0 0 24 24"><path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/></svg>',
  wallet: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1"/><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H5a2 2 0 0 1-2-2z"/><circle cx="16.5" cy="13" r="1.2"/></svg>',
  check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
  scale: '<svg viewBox="0 0 24 24"><path d="M12 4v16"/><path d="M7 8h10"/><path d="M4 12 7 8l3 4a3 3 0 0 1-6 0z"/><path d="M14 12l3-4 3 4a3 3 0 0 1-6 0z"/><path d="M8 20h8"/></svg>',
  chart: '<svg viewBox="0 0 24 24"><path d="M4 4v16h16"/><path d="m7 14 3-3 3 2 4-5"/></svg>',
  tag: '<svg viewBox="0 0 24 24"><path d="M3 7v5.2a2 2 0 0 0 .6 1.4l7 7a2 2 0 0 0 2.8 0l4.8-4.8a2 2 0 0 0 0-2.8l-7-7A2 2 0 0 0 10.8 3H5a2 2 0 0 0-2 2z"/><circle cx="7.5" cy="7.5" r="1.2"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><path d="M7 18a4 4 0 0 1-.5-7.97A5 5 0 0 1 16 9.5a3.5 3.5 0 0 1 1 6.86"/><path d="M7 18h9"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/></svg>',
  code: '<svg viewBox="0 0 24 24"><path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/><path d="m13 6-2 12"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3 5 6v6c0 4 3 6.5 7 9 4-2.5 7-5 7-9V6l-7-3z"/><path d="m9 12 2 2 4-4"/></svg>',
};

const SCRIPT = `
(function () {
  var DEMO = window.__DEMO__ || { results: {} };
  var RUB = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 });
  function rub(k) { return RUB.format((k || 0) / 100); }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function pill(kind, text) { return '<span class="pill ' + kind + '">' + esc(text) + '</span>'; }

  function renderCash(r) {
    var html = '<div class="title">Остаток по всем счетам на ' + esc((r.as_of || '').slice(0, 10)) + '</div>' +
      '<div class="metric">' + rub(r.total.amount) + ' <small>' + esc(r.total.currency) + '</small></div>' +
      '<div class="caption">Консолидировано автоматически, с пометкой актуальности данных.</div>';
    if (r.by_account && r.by_account.length) {
      html += '<table><tr><th>Счёт</th><th>Банк</th><th class="num">Остаток</th></tr>';
      r.by_account.forEach(function (a) {
        html += '<tr><td>…' + esc(String(a.account_id).slice(-4)) + '</td><td>' + esc(a.bank || a.source) +
          '</td><td class="num">' + rub(a.amount) + '</td></tr>';
      });
      html += '</table>';
    }
    return html;
  }

  function renderPayment(r) {
    var kind = r.status === 'found' ? 'ok' : (r.status === 'pending' ? 'warn' : 'bad');
    var label = r.status === 'found' ? 'Платёж найден' : (r.status === 'pending' ? 'В обработке' : 'Не найден');
    var top = (r.matches && r.matches[0]) || null;
    var html = '<div class="pills">' + pill(kind, label) + '</div>';
    if (top) {
      var tx = top.transaction;
      html += '<div class="caption">Найдено в выписке по номеру документа и сумме, уверенность ' +
        Math.round(top.confidence * 100) + '%.</div>';
      html += '<table><tr><th>Документ</th><th>Назначение</th><th class="num">Сумма</th></tr>' +
        '<tr><td>' + esc(tx.doc_number || '—') + '</td><td>' + esc(tx.purpose || '—') +
        '</td><td class="num">' + rub(tx.amount) + '</td></tr></table>';
    } else {
      html += '<div class="caption">Совпадений в выписке не найдено.</div>';
    }
    return html;
  }

  var EXC = {
    partial_payment: { t: 'Частичный платёж', k: 'warn', s: function (e) { return 'В банке на ' + rub(e.delta) + ' меньше, чем в учёте — остаток не закрыт.'; } },
    missing_in_ledger: { t: 'Нет в учёте', k: 'bad', s: function () { return 'Операция есть в банке, но проводки в учёте нет.'; } },
    missing_in_bank: { t: 'Нет в банке', k: 'bad', s: function () { return 'Проводка в учёте есть, но платёж в банке не найден — мог не пройти.'; } },
  };
  function renderReconcile(r) {
    var s = r.summary;
    var html = '<div class="pills">' + pill('ok', s.matched + ' сошлось') + pill('warn', s.partial + ' частично') +
      pill('bad', (s.unmatched_bank + s.unmatched_ledger) + ' расхождений') + '</div>' +
      '<div class="caption">Сверено на ' + rub(s.matched_amount) + '. Расхождения — ниже.</div><ul class="exc">';
    (r.exceptions || []).forEach(function (e) {
      var meta = EXC[e.type] || { t: e.type, k: 'warn', s: function () { return e.suggestion || ''; } };
      html += '<li><span class="t ' + meta.k + '">' + esc(meta.t) + '</span><span class="s">' + esc(meta.s(e)) + '</span></li>';
    });
    html += '</ul>';
    return html;
  }

  function renderForecast(r) {
    var g = r.gap;
    var html;
    if (g.will_occur) {
      html = '<div class="pills">' + pill('bad', 'Кассовый разрыв') + '</div>' +
        '<div class="metric" style="color:var(--danger)">−' + rub(g.deficit_amount).replace('-', '') + '</div>' +
        '<div class="caption">Денег не хватит <b>' + esc(g.first_gap_date) + '</b>. Видно заранее — есть время среагировать.</div>';
    } else {
      html = '<div class="pills">' + pill('ok', 'Разрыва нет') + '</div>' +
        '<div class="caption">Минимальный остаток не опустится ниже ' + rub(g.min_balance) + '.</div>';
    }
    html += '<table><tr><th>Дата</th><th class="num">Приход</th><th class="num">Расход</th><th class="num">Остаток</th></tr>';
    (r.daily || []).forEach(function (d) {
      if (d.inflows === 0 && d.outflows === 0) return;
      var cls = d.projected_balance < 0 ? ' class="gap"' : '';
      html += '<tr' + cls + '><td>' + esc(d.date) + '</td><td class="num">' + (d.inflows ? rub(d.inflows) : '—') +
        '</td><td class="num">' + (d.outflows ? rub(d.outflows) : '—') + '</td><td class="num">' + rub(d.projected_balance) + '</td></tr>';
    });
    html += '</table>';
    return html;
  }

  var RENDER = { get_cash_position: renderCash, check_payment: renderPayment, reconcile: renderReconcile, cashgap_forecast: renderForecast };

  function showAnswer(tool) {
    var out = document.getElementById('answer');
    out.innerHTML = '<div class="shimmer"><span class="spin"></span> AI считает по вашим данным…</div>';
    setTimeout(function () {
      var result = (DEMO.results || {})[tool];
      function paint(res) {
        var body;
        try { body = RENDER[tool](res); } catch (e) { body = '<div class="exc">' + esc(e.message) + '</div>'; }
        out.innerHTML = '<div class="answer-body">' + body + '</div>' +
          '<details class="raw"><summary>Ответ MCP-сервера (JSON)</summary><pre>' + esc(JSON.stringify(res, null, 2)) + '</pre></details>';
      }
      if (result) { paint(result); return; }
      fetch('/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: tool }) })
        .then(function (r) { return r.json(); })
        .then(function (d) { paint(d.result); })
        .catch(function () { out.innerHTML = '<div class="empty">Не удалось получить ответ. Обновите страницу.</div>'; });
    }, 420);
  }

  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-tool]');
    if (!btn) return;
    document.querySelectorAll('.ask').forEach(function (b) { b.classList.remove('active'); });
    btn.classList.add('active');
    showAnswer(btn.getAttribute('data-tool'));
  });

  function validEmail(v) { return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(v); }
  document.addEventListener('submit', function (ev) {
    var form = ev.target.closest('.lead-form');
    if (!form) return;
    ev.preventDefault();
    var input = form.querySelector('input[type=email]');
    var status = form.parentNode.querySelector('.lead-status');
    var email = (input.value || '').trim();
    if (!validEmail(email)) { if (status) { status.className = 'lead-status err'; status.textContent = 'Введите корректный email.'; } return; }
    var btn = form.querySelector('button');
    btn.disabled = true; var prev = btn.textContent; btn.textContent = 'Отправляем…';
    fetch('/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, source: form.getAttribute('data-source') || 'landing' }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok && d.ok }; }); })
      .then(function (res) {
        if (res.ok) {
          if (status) { status.className = 'lead-status ok'; status.textContent = 'Спасибо! Свяжемся с вами и развернём демо на ваших данных.'; }
          input.value = ''; btn.textContent = 'Готово ✓';
        } else {
          if (status) { status.className = 'lead-status err'; status.textContent = 'Что-то пошло не так. Попробуйте ещё раз.'; }
          btn.disabled = false; btn.textContent = prev;
        }
      })
      .catch(function () {
        if (status) { status.className = 'lead-status err'; status.textContent = 'Сеть недоступна. Попробуйте ещё раз.'; }
        btn.disabled = false; btn.textContent = prev;
      });
  });
})();
`;

const PROBLEMS = [
  { n: '01', h: 'Картина размазана по банкам и площадкам', p: 'Деньги в нескольких банках плюс выплаты Ozon, Wildberries и Я.Маркета. Единой цифры не видит никто, а отчёты площадок сырые и не читаются без ручной обработки.' },
  { n: '02', h: 'Деньги на счету есть — прибыли не видно', p: 'Комиссии, логистика, хранение, возвраты и реклама съедают маржу незаметно. Остаток на счёте ≠ прибыль, и понять реальную маржу без сведения всех данных невозможно.' },
  { n: '03', h: 'Кассовый разрыв ловят постфактум', p: 'Площадки платят с задержкой, поставщики требуют предоплату, накладывается сезонность. О нехватке денег узнают, когда платить уже нечем.' },
  { n: '04', h: 'Сверка и выписки — руками', p: 'Выписки, сопоставление с учётом, дубли при импорте. Часы ручной работы в Excel, а ошибки всплывают в конце месяца, когда исправлять поздно.' },
];

const FEATURES = [
  { ico: 'wallet', h: 'Единая позиция по деньгам', p: 'Консолидированный остаток по всем банкам и счетам в один запрос — с честной пометкой, насколько свежие данные.' },
  { ico: 'check', h: 'Проверка платежей за секунду', p: '«Прошёл ли платёж» по номеру и сумме — AI сам находит операцию в выписке, без ручного поиска.' },
  { ico: 'scale', h: 'Автосверка банк ↔ учёт', p: 'Автоматическое сопоставление выписки с учётной системой и понятный список расхождений с подсказками.' },
  { ico: 'chart', h: 'Прогноз кассовых разрывов', p: 'Когда и на сколько не хватит денег по плановым поступлениям и выплатам — пока ещё можно принять меры.' },
  { ico: 'layers', h: 'Коннекторы маркетплейсов', p: 'Выплаты и удержания Ozon, Wildberries и Я.Маркета — в общем финансовом контексте рядом с банками.', tag: 'скоро' },
  { ico: 'tag', h: 'Прибыль и маржа по SKU', p: 'Реальная прибыль с учётом комиссий, логистики, хранения и возвратов — по товару и категории, а не только по счёту.', tag: 'скоро' },
];

const ASKS = [
  { tool: 'get_cash_position', q: 'Сколько у нас денег по всем счетам?', d: 'Единый остаток по банкам' },
  { tool: 'check_payment', q: 'Оплата от контрагента прошла?', d: 'Поиск платежа в выписке' },
  { tool: 'reconcile', q: 'Банк сходится с учётом?', d: 'Автосверка и расхождения' },
  { tool: 'cashgap_forecast', q: 'Хватит денег до конца месяца?', d: 'Прогноз кассового разрыва' },
];

const SECURITY = [
  { ico: 'cloud', h: 'Self-hosted в вашем облаке', p: 'Сервер разворачивается в вашем Yandex Cloud одним модулем Terraform. Инфраструктура — ваша.' },
  { ico: 'lock', h: 'Токены в вашем Lockbox', p: 'Ключи от банков и учёта хранятся в вашем защищённом хранилище и наружу не уходят. Посредника нет.' },
  { ico: 'eye', h: 'Только чтение', p: 'Доступ к банкам и учёту — read-only. Посмотреть данные можно, увести деньги — физически нельзя.' },
  { ico: 'shield', h: 'Открыт для аудита', p: 'Код разворачивается у вас и доступен для проверки вашей службой ИБ или независимым аудитом. Никакого чёрного ящика.' },
];

function leadForm(source, buttonText) {
  return (
    '<div>' +
    '<form class="lead-form" data-source="' + escapeHtml(source) + '">' +
    '<input type="email" name="email" placeholder="Рабочий email" autocomplete="email" required>' +
    '<button type="submit" class="btn btn-primary">' + escapeHtml(buttonText) + '</button>' +
    '</form>' +
    '<div class="lead-status" role="status" aria-live="polite"></div>' +
    '</div>'
  );
}

function problemCard(x) {
  return '<div class="problem"><div class="num">' + x.n + '</div><h3>' + escapeHtml(x.h) + '</h3><p>' + escapeHtml(x.p) + '</p></div>';
}
function featureCard(x) {
  return (
    '<div class="feature">' + (x.tag ? '<span class="tag">' + escapeHtml(x.tag) + '</span>' : '') +
    '<div class="ico">' + ICON[x.ico] + '</div><h3>' + escapeHtml(x.h) + '</h3><p>' + escapeHtml(x.p) + '</p></div>'
  );
}
function askCard(x) {
  return '<button class="ask" data-tool="' + x.tool + '"><div class="q">' + escapeHtml(x.q) + '</div><div class="d">' + escapeHtml(x.d) + '</div></button>';
}
function secItem(x) {
  return '<div class="sec-item"><div class="ico">' + ICON[x.ico] + '</div><div><h3>' + escapeHtml(x.h) + '</h3><p>' + escapeHtml(x.p) + '</p></div></div>';
}

const RU_MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
function ruDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return escapeHtml(iso);
  return `${Number(m[3])} ${RU_MONTHS[Number(m[2]) - 1]}`;
}

function cashFrom(embedded) {
  const r = embedded.results && embedded.results.get_cash_position;
  return r && r.total ? r.total.amount : 45000000;
}
function formatRub(kopecks) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format((kopecks || 0) / 100);
}

function heroMock(meta, startKopecks) {
  const scheduled = (meta.forecast && meta.forecast.scheduled) || [];
  const items = scheduled.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let running = startKopecks;
  let firstGap = null;
  const rows = items
    .map((it) => {
      const isIn = it.direction === 'in';
      const delta = isIn ? it.amount : -it.amount;
      running += delta;
      if (running < 0 && !firstGap) firstGap = it.date;
      const neg = running < 0;
      const sign = isIn ? '+' : '−';
      return (
        '<div class="r' + (neg ? ' neg' : '') + '">' +
        '<span class="k">' + ruDate(it.date) + ' · ' + escapeHtml(it.label || '') + '</span>' +
        '<span class="d ' + (isIn ? 'in' : 'out') + '">' + sign + formatRub(Math.abs(delta)).replace('-', '') + '</span>' +
        '<span class="v">' + formatRub(running) + '</span>' +
        '</div>'
      );
    })
    .join('');
  const flag = firstGap
    ? '<div class="flag">⚠ ' + ruDate(firstGap) + ' остаток уходит в минус — FinContext предупреждает заранее</div>'
    : '';
  return (
    '<div class="mock">' +
    '<div class="bar"><i></i><i></i><i></i></div>' +
    '<div class="q">Вы: <b>Сколько у нас денег и хватит ли до конца месяца?</b></div>' +
    '<div class="a-metric">' + escapeHtml(formatRub(startKopecks)) + '</div>' +
    '<div class="a-sub">сейчас, по всем счетам · обновлено сегодня</div>' +
    '<div class="start"><span>Дальше по плану платежей:</span><span>остаток</span></div>' +
    '<div class="rows">' + rows + '</div>' +
    flag +
    '</div>'
  );
}

function landingHtml(demo) {
  const data = demo || {};
  const meta = data.meta || demoMeta();
  const embedded = { results: data.results || {} };
  const scenario = escapeHtml(meta.scenario || 'Розничный бизнес');
  return (
    '<!doctype html>\n<html lang="ru">\n<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>FinContext — все деньги бизнеса, банки и маркетплейсы, в одном ответе AI</title>\n' +
    '<meta name="description" content="FinContext сводит счета всех банков и маркетплейсов в единый финансовый контекст для AI-ассистента: реальный кэш, статус платежей, автосверка и прогноз кассовых разрывов. Self-hosted, данные не покидают ваш контур.">\n' +
    '<style>' + STYLE + '</style>\n' +
    '</head>\n<body>\n' +
    '<nav><div class="wrap row">' +
    '<div class="brand"><span class="dot"></span> FinContext</div>' +
    '<div class="nav-links">' +
    '<a href="#problem">Проблема</a>' +
    '<a href="#features">Возможности</a>' +
    '<a href="#demo">Демо</a>' +
    '<a href="#security">Безопасность</a>' +
    '<a href="#cta" class="btn btn-primary">Получить доступ</a>' +
    '</div></div></nav>\n' +

    '<header class="hero"><div class="wrap hero-grid">' +
    '<div>' +
    '<span class="eyebrow">Финансовый контекст для AI-ассистента</span>' +
    '<h1>Все деньги бизнеса — <span class="grad">банки и маркетплейсы</span> — в одном ответе AI</h1>' +
    '<p class="lede">FinContext сводит счета всех банков и площадок в единую финансовую картину. ' +
    'Реальный кэш, статус платежей, автосверка и прогноз кассовых разрывов — на один вопрос, без выгрузок и Excel.</p>' +
    leadForm('hero', 'Получить доступ') +
    '<div class="lead-note">Развернём демо на ваших данных. Без спама — только по делу.</div>' +
    '<div class="hero-note"><span class="lk">🔒</span><div><b>Это не облачный сервис.</b> FinContext разворачивается в вашем Yandex Cloud: данные и токены банков остаются у вас, у нас доступа к ним нет.</div></div>' +
    '<div class="trust-line">' +
    '<span><span class="tick">✓</span> Self-hosted в вашем облаке</span>' +
    '<span><span class="tick">✓</span> Токены в вашем Lockbox</span>' +
    '<span><span class="tick">✓</span> Только чтение</span>' +
    '</div>' +
    '</div>' +
    heroMock(meta, cashFrom(embedded)) +
    '</div></header>\n' +

    '<div class="logos"><div class="wrap inner">' +
    '<span class="label">Подключается к вашим банкам, площадкам и учёту:</span>' +
    '<span class="chip">Точка</span>' +
    '<span class="chip">МойСклад</span>' +
    '<span class="chip soon">Ozon</span>' +
    '<span class="chip soon">Wildberries</span>' +
    '<span class="chip soon">Я.Маркет</span>' +
    '<span class="chip soon">1С</span>' +
    '<span class="chip soon">Контур</span>' +
    '</div></div>\n' +

    '<section id="problem"><div class="wrap">' +
    '<div class="section-head"><h2>Бизнес растёт — а деньги как в тумане</h2>' +
    '<p>Чем больше счетов, площадок и платежей, тем дороже обходится «знать примерно».</p></div>' +
    '<div class="grid-auto">' + PROBLEMS.map(problemCard).join('') + '</div>' +
    '</div></section>\n' +

    '<section id="features"><div class="wrap">' +
    '<div class="section-head"><h2>Что делает FinContext</h2>' +
    '<p>Ответы, которые нужны каждый день — на языке вопроса к AI. Часть уже работает, часть на подходе.</p></div>' +
    '<div class="features">' + FEATURES.map(featureCard).join('') + '</div>' +
    '</div></section>\n' +

    '<section><div class="wrap band">' +
    '<h2>Не ещё один дашборд, который надо «вести»</h2>' +
    '<p>Вы уже пользуетесь AI-ассистентом. FinContext через MCP даёт ему контекст о ваших деньгах — и он отвечает на живые вопросы сам. Учиться новому интерфейсу не нужно.</p>' +
    '</div></section>\n' +

    '<section id="demo"><div class="wrap">' +
    '<div class="section-head"><h2>Посмотрите на реальном примере</h2>' +
    '<p>Живые ответы движка на данных примера. Ничего подключать не нужно — выберите вопрос.</p></div>' +
    '<div class="demo-panel">' +
    '<div class="scenario">Сценарий: <b>' + scenario + '</b>. На счёте 450 000 ₽, но впереди аренда, зарплата и закупка — а оптовый приход только в конце месяца.</div>' +
    '<div class="demo-grid">' +
    '<div class="ask-list">' + ASKS.map(askCard).join('') + '</div>' +
    '<div class="answer" id="answer"><div class="empty">Выберите вопрос слева — AI ответит по данным примера.</div></div>' +
    '</div>' +
    '</div>' +
    '</div></section>\n' +

    '<section id="security"><div class="wrap"><div class="security">' +
    '<span class="eyebrow">Не облачный сервис</span>' +
    '<h2>Данные не уходят с ваших серверов</h2>' +
    '<p style="color:var(--muted);font-size:18px;max-width:680px">В отличие от SaaS-сервисов учёта, FinContext не собирает ваши данные у себя. Всё работает внутри вашего периметра — доверять вендору ничего не нужно.</p>' +
    '<div class="arch">' +
    '<div class="perimeter"><span class="plabel">🔒 Ваше облако (Yandex Cloud)</span>' +
    '<div class="flow">' +
    '<div class="node">Банки и маркетплейсы<small>токены в вашем Lockbox</small></div>' +
    '<span class="arrow">→</span>' +
    '<div class="node accent">FinContext MCP<small>работает у вас</small></div>' +
    '<span class="arrow">→</span>' +
    '<div class="node">Ваш AI-ассистент<small>ваши вопросы</small></div>' +
    '</div></div>' +
    '<div class="external"><span class="x">✕</span> <span class="who">FinContext (разработчик)</span> — доступа к вашим данным и деньгам нет</div>' +
    '</div>' +
    '<div class="compare-wrap"><table class="compare"><thead><tr><th>&nbsp;</th><th>Обычный SaaS-сервис</th><th>FinContext</th></tr></thead><tbody>' +
    '<tr><td>Где хранятся данные</td><td class="no">на серверах вендора</td><td class="yes">в вашем облаке</td></tr>' +
    '<tr><td>Доступ разработчика к данным</td><td class="no">есть</td><td class="yes">нет</td></tr>' +
    '<tr><td>Токены банков и учёта</td><td class="no">у вендора</td><td class="yes">в вашем Lockbox</td></tr>' +
    '<tr><td>Права доступа к счетам</td><td class="no">по-разному</td><td class="yes">только чтение</td></tr>' +
    '<tr><td>Проверяемость кода</td><td class="no">чёрный ящик</td><td class="yes">открыт для аудита</td></tr>' +
    '</tbody></table></div>' +
    '<div class="security-grid">' + SECURITY.map(secItem).join('') + '</div>' +
    '</div></div></section>\n' +

    '<section id="cta"><div class="wrap"><div class="cta">' +
    '<h2>Сведите все деньги бизнеса в одну картину</h2>' +
    '<p>Оставьте рабочий email — развернём демо на ваших данных и покажем, как это работает у вас.</p>' +
    leadForm('cta', 'Получить доступ') +
    '</div></div></section>\n' +

    '<footer><div class="wrap row">' +
    '<div class="brand"><span class="dot"></span> FinContext</div>' +
    '<span class="muted">Финансовый контекст для AI-ассистента бизнеса · Self-hosted · Данные в вашем контуре</span>' +
    '</div></footer>\n' +

    '<script>window.__DEMO__ = ' + embedJson(embedded) + ';</script>\n' +
    '<script>' + SCRIPT + '</script>\n' +
    '</body>\n</html>\n'
  );
}

module.exports = { landingHtml };
