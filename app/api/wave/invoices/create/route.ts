import { NextRequest, NextResponse } from 'next/server';
import { BusinessKey, getBusinessIdFromKey } from '../../../../../lib/businessSelector';
import { waveGraphQLFetch } from '../../../../../lib/waveClient';

interface CreateInvoiceItemInput {
  description?: string;
  quantity?: number;
  unitPrice: number;
}

interface CreateInvoiceRequestBody {
  businessKey?: BusinessKey;
  customerId?: string;
  currency?: string;
  invoiceDate?: string;
  dueDate?: string;
  memo?: string;
  items?: CreateInvoiceItemInput[];
}

interface InvoiceCreateResult {
  invoiceCreate?: {
    didSucceed: boolean;
    inputErrors?: Array<{
      code: string;
      message: string;
      path: string[];
    }>;
    invoice?: {
      id: string;
      invoiceNumber: string | null;
      status: string;
      invoiceDate: string | null;
      dueDate: string | null;
      viewUrl: string | null;
      pdfUrl: string | null;
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

const CREATE_INVOICE_MUTATION = /* GraphQL */ `
  mutation InvoiceCreate($input: InvoiceCreateInput!) {
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
        pdfUrl
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

function isoDateTodayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysUtc(baseDate: string, days: number): string {
  const date = new Date(`${baseDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function computeDates(invoiceDate?: string, dueDate?: string) {
  const resolvedInvoiceDate = invoiceDate ?? isoDateTodayUTC();
  const resolvedDueDate = dueDate ?? addDaysUtc(resolvedInvoiceDate, 7);
  return { invoiceDate: resolvedInvoiceDate, dueDate: resolvedDueDate };
}

function getGenericProductId(key: BusinessKey): string {
  const envName =
    key === 'manna'
      ? 'WAVE_PRODUCT_ID_GENERIC_MANNA'
      : key === 'bako'
      ? 'WAVE_PRODUCT_ID_GENERIC_BAKO'
      : 'WAVE_PRODUCT_ID_GENERIC_SOCIALION';

  const value = process.env[envName];
  if (!value) {
    throw new Error(`${envName} is not set`);
  }
  return value;
}

function validateRequestBody(
  body: CreateInvoiceRequestBody,
  items: CreateInvoiceItemInput[]
): asserts body is CreateInvoiceRequestBody & { businessKey: BusinessKey; customerId: string } {
  const validKeys: BusinessKey[] = ['manna', 'bako', 'socialion'];

  if (!body.businessKey || !validKeys.includes(body.businessKey)) {
    throw new Error('Invalid businessKey');
  }

  if (!body.customerId || typeof body.customerId !== 'string' || !body.customerId.trim()) {
    throw new Error('Missing customerId');
  }

  if (items.length === 0) {
    throw new Error('Missing or invalid items');
  }

  for (const [index, item] of items.entries()) {
    if (typeof item.unitPrice !== 'number' || !Number.isFinite(item.unitPrice) || item.unitPrice <= 0) {
      throw new Error(`Invalid unitPrice for item ${index}`);
    }
    if (item.quantity !== undefined && (typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0)) {
      throw new Error(`Invalid quantity for item ${index}`);
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

  try {
    let body: CreateInvoiceRequestBody;
    try {
      body = (await req.json()) as CreateInvoiceRequestBody;
    } catch (error) {
      console.error('Invalid JSON body for invoice creation', error);
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const items = Array.isArray(body.items) ? body.items : [];

    try {
      validateRequestBody(body, items);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid request payload';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    let businessId: string;
    try {
      businessId = getBusinessIdFromKey(body.businessKey);
    } catch (error) {
      console.error('Invalid business key or missing business ID env var', error);
      return NextResponse.json({ error: 'Invalid businessKey' }, { status: 400 });
    }

    let productId: string;
    try {
      productId = getGenericProductId(body.businessKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Missing generic product ID';
      console.error(message);
      return NextResponse.json({ error: message }, { status: 500 });
    }

    const { invoiceDate, dueDate } = computeDates(body.invoiceDate, body.dueDate);
    const currency = body.currency ?? 'USD';

    const waveItems = items.map((item) => ({
      productId,
      description: item.description ?? null,
      quantity: item.quantity ?? 1,
      unitPrice: item.unitPrice,
    }));

    const input = {
      businessId,
      customerId: body.customerId,
      status: 'DRAFT',
      currency,
      invoiceDate,
      dueDate,
      items: waveItems,
      memo: body.memo ?? null,
    };

    const data = await waveGraphQLFetch<InvoiceCreateResult>(CREATE_INVOICE_MUTATION, { input });
    const result = data.invoiceCreate;
    const inputErrors = result?.inputErrors ?? [];

    if (!result?.didSucceed || inputErrors.length > 0 || !result.invoice) {
      console.error('Wave invoiceCreate result', JSON.stringify(result, null, 2));
      return NextResponse.json(
        { error: 'Wave invoiceCreate failed', inputErrors },
        { status: 500 }
      );
    }

    const invoice = result.invoice;
    return NextResponse.json(
      {
        businessKey: body.businessKey,
        businessId,
        customerId: body.customerId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        total: invoice.total?.value ?? null,
        amountDue: invoice.amountDue?.value ?? null,
        currency: invoice.total?.currency?.code ?? null,
        customerName: invoice.customer?.name ?? null,
        customerEmail: invoice.customer?.email ?? null,
        viewUrl: invoice.viewUrl,
        pdfUrl: invoice.pdfUrl,
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : undefined;
    console.error('Unexpected error while creating invoice in Wave', error);
    return NextResponse.json(
      { error: 'Unexpected error while creating invoice in Wave', details: message },
      { status: 500 }
    );
  }
}
