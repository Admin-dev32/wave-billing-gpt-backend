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
  invoiceDate?: string;
  dueDate?: string;
  currencyCode?: string;
  notes?: string;
}

interface WaveInvoiceCreateResult {
  invoiceCreate: {
    didSucceed: boolean;
    inputErrors: Array<{
      message: string;
      path: string[];
      code: string;
    }>;
    invoice: {
      id: string;
      invoiceNumber: string | null;
      status: string;
      createdAt: string;
      dueDate: string | null;
      total: { amount: number; currency: { code: string } | null } | null;
      amountDue: { amount: number; currency: { code: string } | null } | null;
      customer: { id: string | null; name: string | null; email: string | null } | null;
      publicUrl: string | null;
    } | null;
  };
}

interface CreatedInvoiceResponseBody {
  businessKey: BusinessKey;
  businessId: string;
  invoice: {
    id: string;
    invoiceNumber: string | null;
    status: string;
    createdAt: string;
    dueDate: string | null;
    totalAmount: number;
    totalCurrency: string;
    amountDue: number;
    customer: {
      id: string | null;
      name: string | null;
      email: string | null;
    };
    publicUrl: string | null;
  };
}

const CREATE_INVOICE_MUTATION = /* GraphQL */ `
  mutation CreateInvoice($input: InvoiceCreateInput!) {
    invoiceCreate(input: $input) {
      didSucceed
      inputErrors {
        message
        path
        code
      }
      invoice {
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

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(baseDate: string, days: number): string {
  const date = new Date(baseDate);
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
    throw new Error('Invalid or missing businessKey');
  }

  if (!body.customer || !body.customer.name?.trim()) {
    throw new Error('Customer name is required');
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new Error('Invoice must have at least one item');
  }

  for (const item of body.items) {
    if (!item.description?.trim()) {
      throw new Error('Item description is required');
    }
    if (item.quantity <= 0) {
      throw new Error('Item quantity must be greater than zero');
    }
    if (item.unitPrice < 0) {
      throw new Error('Item unitPrice cannot be negative');
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
  const dueDate = body.dueDate ?? addDays(invoiceDate, 7);
  const currencyCode = body.currencyCode ?? 'USD';

  let businessId: string;
  try {
    businessId = getBusinessIdFromKey(body.businessKey);
  } catch (error) {
    console.error('Missing business ID environment variable', error);
    return NextResponse.json({ error: 'Unexpected error while creating invoice in Wave' }, { status: 500 });
  }

  const invoiceInput = {
    businessId,
    customer: {
      name: body.customer.name,
      email: body.customer.email || undefined,
    },
    items: body.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: {
        amount: item.unitPrice,
        currency: currencyCode,
      },
    })),
    currency: currencyCode,
    invoiceDate,
    dueDate,
    memo: body.notes || undefined,
  };

  try {
    const data = await waveGraphQLFetch<WaveInvoiceCreateResult>(CREATE_INVOICE_MUTATION, {
      input: invoiceInput,
    });

    const result = data.invoiceCreate;

    if (!result.didSucceed || result.inputErrors.length > 0 || !result.invoice) {
      const errors = result.inputErrors.map((e) => e.message);
      console.error('Failed to create invoice in Wave', errors);
      return NextResponse.json(
        {
          error: 'Failed to create invoice in Wave',
          details: errors,
        },
        { status: 400 }
      );
    }

    const invoice = result.invoice;

    const responseBody: CreatedInvoiceResponseBody = {
      businessKey: body.businessKey,
      businessId,
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber ?? null,
        status: invoice.status,
        createdAt: invoice.createdAt,
        dueDate: invoice.dueDate ?? null,
        totalAmount: Number(invoice.total?.amount ?? 0),
        totalCurrency: invoice.total?.currency?.code ?? currencyCode,
        amountDue: Number(invoice.amountDue?.amount ?? 0),
        customer: {
          id: invoice.customer?.id ?? null,
          name: invoice.customer?.name ?? null,
          email: invoice.customer?.email ?? null,
        },
        publicUrl: invoice.publicUrl ?? null,
      },
    };

    return NextResponse.json(responseBody, { status: 200 });
  } catch (error) {
    console.error('Unexpected error while creating invoice in Wave', error);
    return NextResponse.json(
      { error: 'Unexpected error while creating invoice in Wave' },
      { status: 500 }
    );
  }
}
