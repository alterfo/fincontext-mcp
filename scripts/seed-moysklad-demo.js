'use strict';

const BASE = 'https://api.moysklad.ru/api/remap/1.2';
const token = process.env.LOCKBOX_MOYSKLAD_TOKEN;
const APPLY = process.argv.includes('--apply');

if (!token) {
  process.stderr.write('LOCKBOX_MOYSKLAD_TOKEN is not set (source .env first)\n');
  process.exit(2);
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept-Encoding': 'gzip',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const detail = data && data.errors ? data.errors.map((e) => e.error).join('; ') : text;
    throw new Error(`${method} ${path} -> ${res.status}: ${detail}`);
  }
  return data;
}

const meta = (type, id) => ({
  meta: { href: `${BASE}/entity/${type}/${id}`, type, mediaType: 'application/json' },
});

function isoMoment(offsetDays) {
  const now = new Date();
  const d = new Date(now.getTime() + offsetDays * 86400000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const rub = (n) => n * 100;

const PRODUCTS = [
  { name: 'Футболка базовая', buy: rub(490), sale: rub(1490) },
  { name: 'Рубашка оксфорд', buy: rub(990), sale: rub(2490) },
  { name: 'Джинсы слим', buy: rub(1700), sale: rub(3990) },
  { name: 'Свитшот', buy: rub(1200), sale: rub(2790) },
  { name: 'Платье летнее', buy: rub(1100), sale: rub(2990) },
  { name: 'Юбка миди', buy: rub(900), sale: rub(2190) },
  { name: 'Куртка демисезон', buy: rub(3500), sale: rub(7900) },
  { name: 'Кроссовки', buy: rub(2400), sale: rub(5490) },
];

const COUNTERPARTIES_TO_ENSURE = [
  { name: 'Арендодатель ТЦ', inn: '7701234567' },
  { name: 'Сотрудники (ФОТ)' },
  { name: 'ООО "Текстиль-Опт"', inn: '7729876543' },
];

const PAYMENTS = [
  { dir: 'in', agent: 'Розничный покупатель', day: -20, sum: rub(120000), purpose: 'Розничная выручка' },
  { dir: 'in', agent: 'ООО "Покупатель"', day: -18, sum: rub(180000), purpose: 'Оптовый заказ, партия одежды' },
  { dir: 'out', agent: 'ООО "Текстиль-Опт"', day: -15, sum: rub(250000), purpose: 'Закупка коллекции' },
  { dir: 'in', agent: 'Розничный покупатель', day: -12, sum: rub(95000), purpose: 'Розничная выручка' },
  { dir: 'out', agent: 'Арендодатель ТЦ', day: -10, sum: rub(150000), purpose: 'Аренда торговой точки' },
  { dir: 'in', agent: 'Розничный покупатель', day: -8, sum: rub(110000), purpose: 'Розничная выручка' },
  { dir: 'out', agent: 'Сотрудники (ФОТ)', day: -5, sum: rub(320000), purpose: 'Зарплата продавцов' },
  { dir: 'in', agent: 'Розничный покупатель', day: -3, sum: rub(88000), purpose: 'Розничная выручка' },
  { dir: 'out', agent: 'Арендодатель ТЦ', day: 5, sum: rub(150000), purpose: 'Аренда (следующий месяц)' },
  { dir: 'out', agent: 'Сотрудники (ФОТ)', day: 10, sum: rub(350000), purpose: 'Зарплата' },
  { dir: 'out', agent: 'ООО "Текстиль-Опт"', day: 14, sum: rub(200000), purpose: 'Закупка новой коллекции' },
  { dir: 'in', agent: 'ООО "Покупатель"', day: 20, sum: rub(300000), purpose: 'Оплата оптового заказа (ожидается)' },
];

async function ensureCounterparty(byName, name, inn) {
  if (byName.has(name)) return byName.get(name);
  if (!APPLY) {
    process.stdout.write(`  [dry-run] would create counterparty: ${name}${inn ? ` (ИНН ${inn})` : ''}\n`);
    const stub = { id: `dry-${name}`, name };
    byName.set(name, stub);
    return stub;
  }
  const created = await api('POST', '/entity/counterparty', {
    name,
    ...(inn ? { inn } : {}),
    companyType: inn ? 'legal' : 'individual',
  });
  byName.set(name, created);
  process.stdout.write(`  created counterparty: ${name} (${created.id})\n`);
  return created;
}

async function main() {
  process.stdout.write(APPLY ? '=== APPLY MODE: writing to MoySklad ===\n' : '=== DRY-RUN: no writes (use --apply) ===\n');

  const orgs = await api('GET', '/entity/organization');
  const org = orgs.rows && orgs.rows[0];
  if (!org) throw new Error('no organization found');
  process.stdout.write(`organization: ${org.name} (${org.id})\n`);

  let currency;
  try {
    const cur = await api('GET', '/entity/currency');
    currency = (cur.rows || []).find((c) => c.isoCode === 'RUB') || (cur.rows || [])[0];
  } catch (e) {
    process.stdout.write(`  warn: currency lookup failed (${e.message})\n`);
  }

  let priceType;
  try {
    const pts = await api('GET', '/context/companysettings/pricetype');
    priceType = Array.isArray(pts) ? pts[0] : pts && pts.rows ? pts.rows[0] : pts;
  } catch (e) {
    process.stdout.write(`  warn: pricetype lookup failed (${e.message})\n`);
  }

  let expenseItem;
  const expenses = await api('GET', '/entity/expenseitem?limit=100');
  expenseItem = (expenses.rows || [])[0];
  if (!expenseItem) {
    if (APPLY) {
      expenseItem = await api('POST', '/entity/expenseitem', { name: 'Операционные расходы' });
    } else {
      expenseItem = { id: 'dry-expense' };
    }
  }

  const existingIn = await api('GET', '/entity/paymentin?limit=200');
  const existingOut = await api('GET', '/entity/paymentout?limit=200');
  const seen = new Set();
  for (const p of existingIn.rows || []) seen.add(`paymentin|${p.sum}|${p.paymentPurpose || ''}`);
  for (const p of existingOut.rows || []) seen.add(`paymentout|${p.sum}|${p.paymentPurpose || ''}`);

  const cps = await api('GET', '/entity/counterparty?limit=100');
  const byName = new Map((cps.rows || []).map((c) => [c.name, c]));

  for (const c of COUNTERPARTIES_TO_ENSURE) await ensureCounterparty(byName, c.name, c.inn);

  const existingProducts = await api('GET', '/entity/product?limit=100');
  const productNames = new Set((existingProducts.rows || []).map((p) => p.name));
  for (const p of PRODUCTS) {
    if (productNames.has(p.name)) {
      process.stdout.write(`  skip product (exists): ${p.name}\n`);
      continue;
    }
    const body = { name: p.name };
    if (currency) {
      body.buyPrice = { value: p.buy, currency: meta('currency', currency.id) };
      if (priceType) {
        body.salePrices = [{ value: p.sale, currency: meta('currency', currency.id), priceType: { meta: priceType.meta } }];
      }
    }
    if (!APPLY) {
      process.stdout.write(`  [dry-run] would create product: ${p.name}\n`);
      continue;
    }
    const created = await api('POST', '/entity/product', body);
    process.stdout.write(`  created product: ${p.name} (${created.id})\n`);
  }

  for (const pay of [...PAYMENTS].sort((a, b) => a.day - b.day)) {
    const agent = byName.get(pay.agent);
    if (!agent) {
      process.stdout.write(`  !! missing counterparty: ${pay.agent}\n`);
      continue;
    }
    const entity = pay.dir === 'in' ? 'paymentin' : 'paymentout';
    const dedupKey = `${entity}|${pay.sum}|${pay.purpose}`;
    const label = `day ${pay.day >= 0 ? '+' : ''}${pay.day} ${pay.dir === 'in' ? 'IN' : 'OUT'} ${(pay.sum / 100).toLocaleString('ru-RU')}₽ ${pay.agent}`;
    if (seen.has(dedupKey)) {
      process.stdout.write(`  skip payment (exists): ${label}\n`);
      continue;
    }
    const body = {
      organization: meta('organization', org.id),
      agent: agent.id && !String(agent.id).startsWith('dry-') ? meta('counterparty', agent.id) : undefined,
      sum: pay.sum,
      moment: isoMoment(pay.day),
      paymentPurpose: pay.purpose,
    };
    if (entity === 'paymentout') body.expenseItem = meta('expenseitem', expenseItem.id);
    if (!APPLY) {
      process.stdout.write(`  [dry-run] ${label}\n`);
      continue;
    }
    if (!body.agent) continue;
    const created = await api('POST', `/entity/${entity}`, body);
    seen.add(dedupKey);
    process.stdout.write(`  created ${entity}: ${label} (${created.id})\n`);
  }
}

main().catch((e) => {
  process.stderr.write(`FAILED: ${e.message}\n`);
  process.exit(1);
});
