import { NextRequest, NextResponse } from 'next/server';
import { BusinessKey, getBusinessIdFromKey } from '../../../../../lib/businessSelector';
import { waveGraphQLFetch } from '../../../../../lib/waveClient';

interface CreateInvoiceItemInput {
  description: string;
  unitPrice: number;
  quantity: number;
}

interface CreateInvoiceCustomerInput {
  name: string;
  email?: string;
}

interface CreateInvoiceRequestBody {
  businessKey?: BusinessKey;
  customer?: CreateInvoiceCustomerInput;
  items?: CreateInvoiceItemInput[];
  status?: 'DRAFT' | 'SENT';
  invoiceDate?: string;
  dueDate?: string | null;
  currencyCode?: string;
  memo?: string;
}

interface InvoiceCreateResult {
  invoiceCreate: {
    didSucceed: boolean;
    inputErrors: Array<{
      code: string;
      message: string;
      path: string[];
    }>;
    invoice: {
      id: string;
      invoiceNumber: string | null;
      status: string;
      invoiceDate: string | null;
      dueDate: string | null;
      viewUrl: string | null;
      total: {
        value: number;
        currency: {
          code: string;
        } | null;
      } | null;
      amountDue: {
        value: number;
        currency: {
          code: string;
        } | null;
      } | null;
      customer: {
        id: string;
        name: string;
        email: string | null;
      } | null;
    } | null;
  };
}

interface CreateInvoiceResponseBody {
  businessKey: BusinessKey;
  businessId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  status: string;
  invoiceDate: string | null;
  dueDate: string | null;
  total: number;
  amountDue: number;
  currency: string | null;
  customerName: string | null;
  customerEmail: string | null;
  viewUrl: string | null;
}

const CREATE_INVOICE_MUTATION = /* GraphQL */ `
  mutation CreateInvoice($input: InvoiceCreateInput!) {
    invoiceCreate(input: $input) {
      didSucceed
      inputErrors {
        code
        message
        path
      }
      invoice {
        id
        invoiceNumber
        status
        invoiceDate
        dueDate
        viewUrl
        total {
          value
          currency {
            code
          }
        }
        amountDue {
          value
          currency {
            code
          }
        }
        customer {
          id
          name
          email
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

function addDays(baseDate: string, days: number): string {
  const date = new Date(`${baseDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function validateRequestBody(body: CreateInvoiceRequestBody): asserts body is Required<CreateInvoiceRequestBody> & {
  businessKey: BusinessKey;
  customer: CreateInvoiceCustomerInput;
  items: CreateInvoiceItemInput[];
} {
  const validKeys: BusinessKey[] = ['manna', 'bako', 'socialion'];

  if (!body.businessKey || !validKeys.includes(body.businessKey)) {
    throw new Error('Invalid businessKey');
  }

  if (!body.customer) {
    throw new Error('Missing customer');
  }

  if (!body.customer.name?.trim()) {
    throw new Error('Missing customer.name');
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new Error('Missing or invalid items');
  }

  for (const item of body.items) {
    if (!item.description?.trim()) {
      throw new Error('Item description is required');
    }
    if (typeof item.unitPrice !== 'number' || item.unitPrice <= 0) {
      throw new Error('Item unitPrice must be greater than zero');
    }
    if (typeof item.quantity !== 'number' || item.quantity <= 0) {
      throw new Error('Item quantity must be greater than zero');
    }
  }
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

  let body: CreateInvoiceRequestBody;
  try {
    body = (await req.json()) as CreateInvoiceRequestBody;
  } catch (error) {
    console.error('Invalid JSON body for invoice creation', error);
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    validateRequestBody(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request payload';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const invoiceDate = body.invoiceDate ?? todayIsoDate();
  const computedDueDate = body.dueDate === undefined ? addDays(invoiceDate, 7) : body.dueDate;
  const currencyCode = body.currencyCode ?? 'USD';
  const status = body.status ?? 'DRAFT';

  let businessId: string;
  try {
    businessId = getBusinessIdFromKey(body.businessKey);
  } catch (error) {
    console.error('Invalid business key or missing business ID env var', error);
    return NextResponse.json({ error: 'Invalid businessKey' }, { status: 400 });
  }

  const invoiceInput = {
    businessId,
    status,
    currency: currencyCode,
    invoiceDate,
    dueDate: computedDueDate ?? null,
    memo: body.memo || undefined,
    customer: {
      name: body.customer.name,
      email: body.customer.email || undefined,
    },
    items: body.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: {
        value: item.unitPrice,
        currency: {
          code: currencyCode,
        },
      },
    })),
  };

  try {
    const data = await waveGraphQLFetch<InvoiceCreateResult>(CREATE_INVOICE_MUTATION, {
      input: invoiceInput,
    });

    const result = data.invoiceCreate;

    if (!result.didSucceed || result.inputErrors.length > 0 || !result.invoice) {
      const errors = result.inputErrors.map((e) => e.message);
      console.error('Wave invoiceCreate failed', errors);
      return NextResponse.json(
        {
          error: 'Wave invoiceCreate failed',
          inputErrors: errors,
        },
        { status: 400 }
      );
    }

    const invoice = result.invoice;
    const responseBody: CreateInvoiceResponseBody = {
      businessKey: body.businessKey,
      businessId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber ?? null,
      status: invoice.status,
      invoiceDate: invoice.invoiceDate ?? null,
      dueDate: invoice.dueDate ?? null,
      total: invoice.total?.value ?? 0,
      amountDue: invoice.amountDue?.value ?? 0,
      currency: invoice.total?.currency?.code ?? null,
      customerName: invoice.customer?.name ?? null,
      customerEmail: invoice.customer?.email ?? null,
      viewUrl: invoice.viewUrl ?? null,
    };

    return NextResponse.json(responseBody, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : undefined;
    console.error('Unexpected error while creating invoice in Wave', error);
    return NextResponse.json(
      { error: 'Unexpected error while creating invoice in Wave', details: message },
      { status: 500 }
    );
  }
}
