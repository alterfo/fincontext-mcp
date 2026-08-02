'use strict';

const MONEY = {
  type: 'object',
  properties: {
    amount: { type: 'integer', description: 'Amount in minor units (kopecks).' },
    currency: { type: 'string', description: 'ISO-4217 currency code.', default: 'RUB' },
  },
  required: ['amount', 'currency'],
  additionalProperties: false,
};

const TOOLS = [
  {
    name: 'get_cash_position',
    premium: false,
    module: null,
    description:
      'Real consolidated cash position across all connected bank accounts, with per-account balances and staleness honesty fields.',
    inputSchema: {
      type: 'object',
      properties: {
        as_of: {
          type: 'string',
          format: 'date-time',
          description: 'Point in time to report the position for. Defaults to now.',
        },
        accounts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Restrict to these account ids. Defaults to all accounts.',
        },
        currency: {
          type: 'string',
          description: 'Report totals in this ISO-4217 currency.',
          default: 'RUB',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'check_payment',
    premium: false,
    module: null,
    description:
      'Determine whether a payment has cleared, is still pending, or cannot be found, with matching candidates and an explanation.',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'integer', description: 'Amount in kopecks (positive).' },
        counterparty_inn: { type: 'string', description: 'Counterparty INN to match.' },
        purpose_contains: { type: 'string', description: 'Substring to match in payment purpose.' },
        doc_number: { type: 'string', description: 'Document number to match.' },
        uin: { type: 'string', description: 'UIN (unique accrual identifier) to match.' },
        date_from: { type: 'string', format: 'date', description: 'Start of the search window.' },
        date_to: { type: 'string', format: 'date', description: 'End of the search window.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'cashgap_forecast',
    premium: true,
    module: 'forecast',
    description:
      'Project daily cash balances over a horizon and flag any cash gap (deficit), with an explicit list of assumptions.',
    inputSchema: {
      type: 'object',
      properties: {
        horizon_days: {
          type: 'integer',
          minimum: 1,
          maximum: 365,
          default: 30,
          description: 'Number of days to project forward.',
        },
        scenario: {
          type: 'string',
          enum: ['base', 'conservative'],
          default: 'base',
          description: 'Projection scenario.',
        },
        include_recurring: {
          type: 'boolean',
          default: true,
          description: 'Include detected recurring inflows/outflows.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'reconcile',
    premium: true,
    module: 'reconcile',
    description:
      'Reconcile a bank statement against the accounting ledger for a period, returning matches and typed exceptions.',
    inputSchema: {
      type: 'object',
      properties: {
        period: {
          type: 'object',
          properties: {
            from: { type: 'string', format: 'date' },
            to: { type: 'string', format: 'date' },
          },
          required: ['from', 'to'],
          additionalProperties: false,
        },
        bank_source: {
          type: 'string',
          enum: ['tochka', 'moysklad', 'kontur', '1c'],
          description: 'Source of the bank side.',
        },
        ledger_source: {
          type: 'string',
          enum: ['tochka', 'moysklad', 'kontur', '1c'],
          description: 'Source of the ledger side.',
        },
        tolerance: {
          type: 'object',
          properties: {
            amount_minor: { type: 'integer', minimum: 0, default: 0 },
            days: { type: 'integer', minimum: 0, default: 0 },
          },
          additionalProperties: false,
        },
      },
      required: ['period', 'bank_source', 'ledger_source'],
      additionalProperties: false,
    },
  },
];

function toListEntry(tool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  };
}

function getTool(name) {
  return TOOLS.find((t) => t.name === name);
}

module.exports = { TOOLS, MONEY, toListEntry, getTool };
