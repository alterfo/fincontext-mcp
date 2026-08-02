'use strict';

const {
  createTochkaConnector,
  normalizeAccount,
  normalizeTransaction,
  pickClosingBalance,
  rublesToKopecks,
  SOURCE,
} = require('../src/connectors/tochka');
const { computeId } = require('../src/model');

const ACCOUNT_ID = '40802810000000000001';

const SANDBOX = {
  accounts: {
    Data: {
      Account: [
        {
          accountId: ACCOUNT_ID,
          currency: 'RUB',
          nickname: 'Основной счёт',
          servicer: { bankId: '044525104' },
        },
      ],
    },
  },
  balances: {
    Data: {
      Balance: [
        {
          accountId: ACCOUNT_ID,
          type: 'OpeningAvailable',
          creditDebitIndicator: 'Credit',
          amount: { amount: '1000.00', currency: 'RUB' },
          dateTime: '2026-07-01T00:00:00Z',
        },
        {
          accountId: ACCOUNT_ID,
          type: 'ClosingAvailable',
          creditDebitIndicator: 'Credit',
          amount: { amount: '1500.50', currency: 'RUB' },
          dateTime: '2026-08-01T09:00:00Z',
        },
      ],
    },
  },
  statementCreate: { Data: { Statement: { statementId: 'stmt-1', status: 'Booked' } } },
  statementGet: {
    Data: {
      Statement: [
        {
          accountId: ACCOUNT_ID,
          statementId: 'stmt-1',
          startDateTime: '2026-07-02T00:00:00Z',
          endDateTime: '2026-08-01T00:00:00Z',
          startBalance: {
            type: 'OpeningBooked',
            creditDebitIndicator: 'Credit',
            amount: { amount: '1000.00', currency: 'RUB' },
          },
          endBalance: {
            type: 'ClosingBooked',
            creditDebitIndicator: 'Credit',
            amount: { amount: '1500.50', currency: 'RUB' },
          },
          Transaction: [
            {
              transactionId: 't1',
              creditDebitIndicator: 'Credit',
              status: 'Booked',
              amount: { amount: '1000.00', currency: 'RUB' },
              bookingDateTime: '2026-07-10T12:00:00Z',
              transactionInformation: 'Оплата по счёту 42',
              documentProductNumber: 'DOC-1',
              DebtorParty: { name: 'ООО Ромашка', inn: '7701234567', kpp: '770101001' },
              DebtorAccount: { identification: '40702810900000000042', bic: '044525225' },
            },
            {
              transactionId: 't2',
              creditDebitIndicator: 'Debit',
              status: 'Booked',
              amount: { amount: '250.75', currency: 'RUB' },
              bookingDateTime: '2026-07-12T09:30:00Z',
              transactionInformation: 'Аренда офиса',
              CreditorParty: { name: 'ИП Иванов', inn: '500100732259' },
            },
            {
              transactionId: 't3',
              creditDebitIndicator: 'Credit',
              status: 'Pending',
              amount: { amount: '500.00', currency: 'RUB' },
              bookingDateTime: '2026-07-31T18:00:00Z',
              transactionInformation: 'Предоплата',
              documentProductNumber: 'DOC-3',
            },
          ],
        },
      ],
    },
  },
};

function fakeHttp(calls) {
  return async (url, init) => {
    const method = (init && init.method) || 'GET';
    calls.push(`${method} ${url}`);
    let body;
    if (url.endsWith('/accounts')) body = SANDBOX.accounts;
    else if (url.endsWith('/balances')) body = SANDBOX.balances;
    else if (method === 'POST' && url.endsWith('/statements')) body = SANDBOX.statementCreate;
    else if (url.includes('/statements/stmt-1')) body = SANDBOX.statementGet;
    else body = { Data: {} };
    return {
      ok: true,
      status: 200,
      async json() {
        return body;
      },
      async text() {
        return '';
      },
    };
  };
}

describe('rublesToKopecks', () => {
  test('parses decimal strings without float drift', () => {
    expect(rublesToKopecks('1000.00')).toBe(100000);
    expect(rublesToKopecks('1500.50')).toBe(150050);
    expect(rublesToKopecks('250.75')).toBe(25075);
    expect(rublesToKopecks('0.05')).toBe(5);
    expect(rublesToKopecks('10')).toBe(1000);
    expect(rublesToKopecks('-42.10')).toBe(-4210);
  });
});

describe('normalizeAccount', () => {
  test('maps sandbox account into the unified shape', () => {
    const acct = normalizeAccount(SANDBOX.accounts.Data.Account[0]);
    expect(acct).toMatchObject({
      account_id: ACCOUNT_ID,
      source: SOURCE,
      bank: SOURCE,
      currency: 'RUB',
      bic: '044525104',
    });
  });
});

describe('normalizeTransaction', () => {
  const [t1, t2, t3] = SANDBOX.statementGet.Data.Statement[0].Transaction;

  test('credit becomes an incoming posted transaction with debtor counterparty', () => {
    const tx = normalizeTransaction(t1, { accountId: ACCOUNT_ID });
    expect(tx.id).toBe(computeId(SOURCE, ACCOUNT_ID, 't1'));
    expect(tx.direction).toBe('in');
    expect(tx.status).toBe('posted');
    expect(tx.amount).toBe(100000);
    expect(tx.currency).toBe('RUB');
    expect(tx.purpose).toBe('Оплата по счёту 42');
    expect(tx.doc_number).toBe('DOC-1');
    expect(tx.counterparty).toEqual({
      name: 'ООО Ромашка',
      inn: '7701234567',
      kpp: '770101001',
      account: '40702810900000000042',
      bic: '044525225',
    });
    expect(tx.raw).toBe(t1);
  });

  test('debit becomes an outgoing transaction with creditor counterparty', () => {
    const tx = normalizeTransaction(t2, { accountId: ACCOUNT_ID });
    expect(tx.direction).toBe('out');
    expect(tx.amount).toBe(25075);
    expect(tx.counterparty).toEqual({ name: 'ИП Иванов', inn: '500100732259' });
  });

  test('pending status is preserved and amount stays non-negative', () => {
    const tx = normalizeTransaction(t3, { accountId: ACCOUNT_ID });
    expect(tx.status).toBe('pending');
    expect(tx.direction).toBe('in');
    expect(tx.amount).toBe(50000);
  });
});

describe('pickClosingBalance', () => {
  test('prefers the closing available balance', () => {
    const balance = pickClosingBalance(SANDBOX.balances.Data.Balance);
    expect(balance.closing_balance).toBe(150050);
    expect(balance.currency).toBe('RUB');
    expect(balance.updated_at).toBe('2026-08-01T09:00:00Z');
  });

  test('a debit closing balance is signed negative (overdraft)', () => {
    const balance = pickClosingBalance([
      {
        type: 'ClosingAvailable',
        creditDebitIndicator: 'Debit',
        amount: { amount: '300.00', currency: 'RUB' },
        dateTime: '2026-08-01T09:00:00Z',
      },
    ]);
    expect(balance.closing_balance).toBe(-30000);
  });
});

describe('connector.pull', () => {
  test('pulls accounts, balances, statement and normalized transactions', async () => {
    const calls = [];
    const connector = createTochkaConnector({
      token: 'sandbox.jwt.token',
      baseUrl: 'https://enter.tochka.com/sandbox/v2',
      http: fakeHttp(calls),
    });

    const result = await connector.pull({
      from: '2026-07-02T00:00:00Z',
      to: '2026-08-01T00:00:00Z',
    });

    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].closing_balance).toBe(150050);
    expect(result.accounts[0].updated_at).toBe('2026-08-01T09:00:00Z');

    expect(result.transactions).toHaveLength(3);
    expect(result.transactions.map((t) => t.direction)).toEqual(['in', 'out', 'in']);

    expect(result.statements).toHaveLength(1);
    expect(result.statements[0].opening_balance).toBe(100000);
    expect(result.statements[0].closing_balance).toBe(150050);
    expect(result.statements[0].line_ids).toHaveLength(3);

    expect(calls.some((c) => c.startsWith('GET https://enter.tochka.com/sandbox/v2/open-banking/v1.0/accounts'))).toBe(true);
    expect(calls.some((c) => c.startsWith('POST'))).toBe(true);
  });

  test('requires a token', async () => {
    const connector = createTochkaConnector({ http: async () => ({ ok: true, json: async () => ({}) }) });
    await expect(connector.listAccounts()).rejects.toThrow(/token required/);
  });

  test('non-ok responses raise a descriptive error', async () => {
    const connector = createTochkaConnector({
      token: 't',
      http: async () => ({ ok: false, status: 401, async text() { return 'unauthorized'; } }),
    });
    await expect(connector.listAccounts()).rejects.toThrow(/401 unauthorized/);
  });
});
