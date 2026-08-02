'use strict';

const fs = require('fs');
const path = require('path');
const { makeTransaction, makeStatement, signedAmount } = require('../src/model');
const { createMoyskladConnector } = require('../src/connectors/moysklad');

const BANK_ACCOUNT = '40702810400000000123';
const CLOSING = 45000000;
const rub = (n) => n * 100;
const dayISO = (n) => new Date(Date.now() + n * 86400000).toISOString();

async function main() {
  const token = process.env.LOCKBOX_MOYSKLAD_TOKEN;
  if (!token) throw new Error('LOCKBOX_MOYSKLAD_TOKEN required (source .env first)');

  const asOf = new Date().toISOString().slice(0, 10);
  const from = dayISO(-60).slice(0, 10);
  const to = dayISO(30).slice(0, 10);

  const pulled = await createMoyskladConnector({ token }).pull({ from, to });
  const ledger = pulled.transactions.map((t) => ({ ...t, raw: null }));

  const past = ledger.filter((t) => t.booked_at.slice(0, 10) <= asOf);
  const future = ledger.filter((t) => t.booked_at.slice(0, 10) > asOf);

  const bank = [];
  for (const t of past) {
    if (t.purpose && t.purpose.includes('Оптовый заказ')) continue;
    let amount = t.amount;
    if (t.purpose && t.purpose.includes('Зарплата продавцов')) amount = t.amount - rub(20000);
    bank.push(
      makeTransaction({
        source: 'tochka',
        kind: 'bank',
        account_id: BANK_ACCOUNT,
        native_id: `bank-${t.direction}-${t.doc_number}`,
        direction: t.direction,
        amount,
        currency: 'RUB',
        booked_at: t.booked_at,
        status: 'posted',
        counterparty: t.counterparty,
        purpose: t.purpose,
        doc_number: t.doc_number,
        raw: null,
      })
    );
  }
  bank.push(
    makeTransaction({
      source: 'tochka',
      kind: 'bank',
      account_id: BANK_ACCOUNT,
      native_id: 'bank-fee-1',
      direction: 'out',
      amount: rub(250),
      currency: 'RUB',
      booked_at: dayISO(-7),
      status: 'posted',
      counterparty: { name: 'Банк «Точка»' },
      purpose: 'Комиссия за обслуживание счёта',
      doc_number: 'FEE-1',
      raw: null,
    })
  );

  const net = bank.reduce((acc, tx) => acc + signedAmount(tx), 0);
  const opening = CLOSING - net;

  const statement = makeStatement({
    source: 'tochka',
    account_id: BANK_ACCOUNT,
    period_from: from,
    period_to: asOf,
    opening_balance: opening,
    closing_balance: CLOSING,
    fetched_at: dayISO(0),
    lines: bank,
  });

  const account = {
    account_id: BANK_ACCOUNT,
    source: 'tochka',
    currency: 'RUB',
    bank: 'Точка',
    opening_balance: opening,
    updated_at: dayISO(0),
  };

  const scheduled = future.map((t) => ({
    date: t.booked_at.slice(0, 10),
    direction: t.direction,
    amount: t.amount,
    label: t.purpose,
  }));

  const fixture = {
    generated_at: dayISO(0),
    scenario: 'Магазин одежды — кассовый разрыв на выплате зарплаты до оптового прихода',
    currency: 'RUB',
    account,
    statement,
    transactions: [...bank, ...ledger],
    reconcile: { bank_source: 'tochka', ledger_source: 'moysklad', period: { from, to: asOf } },
    forecast: { as_of: asOf, current_position: CLOSING, currency: 'RUB', horizon_days: 30, scheduled },
  };

  const outPath = path.join(__dirname, '..', 'src', 'demo-data.json');
  fs.writeFileSync(outPath, `${JSON.stringify(fixture, null, 2)}\n`);
  process.stdout.write(
    `wrote ${path.relative(path.join(__dirname, '..'), outPath)}: ${bank.length} bank + ${ledger.length} ledger txns, ${scheduled.length} scheduled, closing ${CLOSING / 100}₽\n`
  );
}

main().catch((e) => {
  process.stderr.write(`FAILED: ${e.message}\n`);
  process.exit(1);
});
