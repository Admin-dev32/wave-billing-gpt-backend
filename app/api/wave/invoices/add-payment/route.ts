import { NextRequest, NextResponse } from 'next/server';
import { waveGraphQLFetch } from '../../../../../lib/waveClient';
import { BusinessKey, getBusinessIdFromKey } from '../../../../../lib/businessSelector';

interface AddPaymentRequestBody {
  businessKey?: BusinessKey;
  invoiceId?: string;
  invoiceNumber?: string;
  amount?: number;
  paymentDate?: string;
}

interface InvoiceLookupResult {
  business: {
    invoice?: InvoiceNode | null;
    invoices?: {
      edges: Array<{ node: InvoiceNode }>;
    } | null;
  } | null;
}

interface InvoiceNode {
  id: string;
  invoiceNumber: string | null;
  status: string;
  createdAt: string;
  dueDate: string | null;
  total: { amount: number; currency: { code: string } | null } | null;
  amountDue: { amount: number; currency: { code: string } | null } | null;
  customer: { id: string; name: string | null; email: string | null } | null;
  publicUrl: string | null;
}

interface MoneyTransactionCreateResult {
  moneyTransactionCreate: {
    didSucceed: boolean;
    inputErrors: Array<{ message: string; path?: string[]; code?: string }> | null;
    moneyTransaction: {
      id: string;
      date: string;
      description: string | null;
      externalId: string | null;
      anchor: {
        amount: { value: number };
        direction: string;
      };
    } | null;
  } | null;
}

interface PaymentRecord {
  id: string;
  amount: number;
  currency: string;
  date: string;
  description: string | null;
  externalId: string | null;
}

interface UpdatedInvoiceInfo {
  id: string;
  invoiceNumber: string | null;
  status: string;
  createdAt: string;
  dueDate: string | null;
  totalAmount: number;
  totalCurrency: string;
  amountDue: number;
  customer: { id: string | null; name: string | null; email: string | null };
  publicUrl: string | null;
}

interface AddPaymentResponseBody {
  businessKey: BusinessKey;
  businessId: string;
  payment: PaymentRecord;
  invoice: UpdatedInvoiceInfo;
}

const FIND_INVOICE_BY_ID_QUERY = /* GraphQL */ `
  query InvoiceById($businessId: ID!, $invoiceId: ID!) {
    business(id: $businessId) {
      id
      invoice(id: $invoiceId) {
        id
        invoiceNumber
        status
        createdAt
        dueDate
        total {
          amount
          currency {
            code
          }
        }
        amountDue {
          amount
          currency {
            code
          }
        }
        customer {
          id
          name
          email
        }
        publicUrl
      }
    }
  }
`;

const FIND_INVOICE_BY_NUMBER_QUERY = /* GraphQL */ `
  query InvoiceByNumber($businessId: ID!, $invoiceNumber: String!) {
    business(id: $businessId) {
      id
      invoices(invoiceNumber: $invoiceNumber, page: 1, pageSize: 1) {
        edges {
          node {
            id
            invoiceNumber
            status
            createdAt
            dueDate
            total {
              amount
              currency {
                code
              }
            }
            amountDue {
              amount
              currency {
                code
              }
            }
            customer {
              id
              name
              email
            }
            publicUrl
          }
        }
      }
    }
  }
`;

const MONEY_TRANSACTION_CREATE_MUTATION = /* GraphQL */ `
  mutation AddInvoicePayment($input: MoneyTransactionCreateInput!) {
    moneyTransactionCreate(input: $input) {
      didSucceed
      inputErrors {
        message
        path
        code
      }
      moneyTransaction {
        id
        date
        description
        externalId
        anchor {
          amount {
            value
          }
          direction
        }
      }
    }
  }
`;

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function readEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set`);
  }

  return value;
}

function getAccountIdsFromKey(key: BusinessKey): { anchorAccountId: string; incomeAccountId: string } {
  switch (key) {
    case 'manna':
      return {
        anchorAccountId: readEnv('WAVE_ANCHOR_ACCOUNT_ID_MANNA'),
        incomeAccountId: readEnv('WAVE_INCOME_ACCOUNT_ID_MANNA'),
      };
    case 'bako':
      return {
        anchorAccountId: readEnv('WAVE_ANCHOR_ACCOUNT_ID_BAKO'),
        incomeAccountId: readEnv('WAVE_INCOME_ACCOUNT_ID_BAKO'),
      };
    case 'socialion':
      return {
        anchorAccountId: readEnv('WAVE_ANCHOR_ACCOUNT_ID_SOCIALION'),
        incomeAccountId: readEnv('WAVE_INCOME_ACCOUNT_ID_SOCIALION'),
      };
    default: {
      const exhaustiveCheck: never = key;
      throw new Error(`Unknown business key: ${exhaustiveCheck}`);
    }
  }
}

function mapInvoiceNode(node: InvoiceNode): UpdatedInvoiceInfo {
  return {
    id: node.id,
    invoiceNumber: node.invoiceNumber ?? null,
    status: node.status,
    createdAt: node.createdAt,
    dueDate: node.dueDate ?? null,
    totalAmount: Number(node.total?.amount ?? 0),
    totalCurrency: node.total?.currency?.code ?? '',
    amountDue: Number(node.amountDue?.amount ?? 0),
    customer: {
      id: node.customer?.id ?? null,
      name: node.customer?.name ?? null,
      email: node.customer?.email ?? null,
    },
    publicUrl: node.publicUrl ?? null,
  };
}

function validateBody(body: AddPaymentRequestBody): string | null {
  const validKeys: BusinessKey[] = ['manna', 'bako', 'socialion'];

  if (!body.businessKey || !validKeys.includes(body.businessKey)) {
    return 'Invalid or missing businessKey';
  }

  if (!body.invoiceId && !body.invoiceNumber) {
    return 'Either invoiceId or invoiceNumber must be provided';
  }

  if (typeof body.amount !== 'number' || Number.isNaN(body.amount) || body.amount <= 0) {
    return 'Payment amount must be greater than zero';
  }

  return null;
}

async function lookupInvoice(
  businessId: string,
  invoiceId?: string,
  invoiceNumber?: string
): Promise<InvoiceNode | null> {
  if (invoiceId) {
    const data = await waveGraphQLFetch<InvoiceLookupResult>(FIND_INVOICE_BY_ID_QUERY, {
      businessId,
      invoiceId,
    });
    return data.business?.invoice ?? null;
  }

  if (invoiceNumber) {
    const data = await waveGraphQLFetch<InvoiceLookupResult>(FIND_INVOICE_BY_NUMBER_QUERY, {
      businessId,
      invoiceNumber,
    });
    const edge = data.business?.invoices?.edges[0];
    return edge?.node ?? null;
  }

  return null;
}

export async function POST(req: NextRequest) {
  if (req.method !== 'POST') {
    return NextResponse.json(
      { error: 'Method Not Allowed' },
      { status: 405, headers: { Allow: 'POST' } }
    );
  }

  const secret = req.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    return unauthorized();
  }

  let body: AddPaymentRequestBody;
  try {
    body = (await req.json()) as AddPaymentRequestBody;
  } catch (error) {
    console.error('Invalid JSON body for add-payment', error);
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const validationError = validateBody(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  let businessId: string;
  let anchorAccountId: string;
  let incomeAccountId: string;
  try {
    businessId = getBusinessIdFromKey(body.businessKey as BusinessKey);
    const accountIds = getAccountIdsFromKey(body.businessKey as BusinessKey);
    anchorAccountId = accountIds.anchorAccountId;
    incomeAccountId = accountIds.incomeAccountId;
  } catch (error) {
    console.error('Missing business configuration', error);
    return NextResponse.json({ error: 'Invalid or missing business configuration' }, { status: 400 });
  }

  const paymentDate = body.paymentDate || todayIsoDate();
  const amount = Number(body.amount);

  try {
    const invoiceNode = await lookupInvoice(businessId, body.invoiceId, body.invoiceNumber);

    if (!invoiceNode) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const mutationInput = {
      businessId,
      externalId: `invoice:${invoiceNode.id}`,
      date: paymentDate,
      description: 'Invoice Payment',
      anchor: {
        accountId: anchorAccountId,
        amount,
        direction: 'DEPOSIT',
      },
      lineItems: [
        {
          accountId: incomeAccountId,
          amount,
          balance: 'INCREASE',
        },
      ],
    };

    const mutationResult = await waveGraphQLFetch<MoneyTransactionCreateResult>(
      MONEY_TRANSACTION_CREATE_MUTATION,
      { input: mutationInput }
    );

    const payload = mutationResult.moneyTransactionCreate;

    if (!payload?.didSucceed || !payload.moneyTransaction) {
      const details = payload?.inputErrors?.map((err) => err.message) ?? ['Unknown error'];
      console.error('Failed to register payment in Wave', payload?.inputErrors);
      return NextResponse.json(
        { error: 'Failed to register payment in Wave', details },
        { status: 400 }
      );
    }

    const updatedInvoiceData = await waveGraphQLFetch<InvoiceLookupResult>(FIND_INVOICE_BY_ID_QUERY, {
      businessId,
      invoiceId: invoiceNode.id,
    });

    const updatedInvoiceNode = updatedInvoiceData.business?.invoice;
    if (!updatedInvoiceNode) {
      console.error('Payment created but failed to refetch updated invoice', updatedInvoiceData);
      return NextResponse.json(
        { error: 'Payment created but failed to refetch updated invoice' },
        { status: 500 }
      );
    }

    const invoice = mapInvoiceNode(updatedInvoiceNode);

    const payment: PaymentRecord = {
      id: payload.moneyTransaction.id,
      amount,
      currency: invoice.totalCurrency || 'USD',
      date: payload.moneyTransaction.date,
      description: payload.moneyTransaction.description,
      externalId: payload.moneyTransaction.externalId,
    };

    const responseBody: AddPaymentResponseBody = {
      businessKey: body.businessKey as BusinessKey,
      businessId,
      payment,
      invoice,
    };

    return NextResponse.json(responseBody, { status: 200 });
  } catch (error) {
    console.error('Unexpected error while adding payment to invoice in Wave', error);
    return NextResponse.json(
      {
        error: 'Unexpected error while adding payment to invoice in Wave',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
