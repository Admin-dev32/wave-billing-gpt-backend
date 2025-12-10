import { NextRequest, NextResponse } from 'next/server';
import { BusinessKey, getBusinessIdFromKey } from '../../../../../lib/businessSelector';
import { waveGraphQLFetch } from '../../../../../lib/waveClient';

interface CreateInvoiceRequestBody {
  businessKey?: BusinessKey;
  customerId?: string;
  currency?: string;
  invoiceDate?: string;
  dueDate?: string;
  memo?: string;
  items?: Array<{
    description?: string;
    quantity?: number;
    unitPrice: number;
  }>;
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
      pdfUrl?: string | null;
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

function getGenericProductId(key: BusinessKey): string {
  const envMap: Record<BusinessKey, string | undefined> = {
    manna: process.env.WAVE_PRODUCT_ID_GENERIC_MANNA,
    bako: process.env.WAVE_PRODUCT_ID_GENERIC_BAKO,
    socialion: process.env.WAVE_PRODUCT_ID_GENERIC_SOCIALION,
  };

  const productId = envMap[key];
  if (!productId) {
    throw new Error(`Missing generic product ID for business ${key}`);
  }

  return productId;
}

function validateRequestBody(body: CreateInvoiceRequestBody): asserts body is Required<CreateInvoiceRequestBody> {
  const validKeys: BusinessKey[] = ['manna', 'bako', 'socialion'];

  if (!body.businessKey || !validKeys.includes(body.businessKey)) {
    throw new Error('Invalid businessKey');
  }

  if (!body.customerId || typeof body.customerId !== 'string' || !body.customerId.trim()) {
    throw new Error('Missing customerId');
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new Error('Missing or invalid items');
  }

  for (const [index, item] of body.items.entries()) {
    if (typeof item.unitPrice !== 'number' || Number.isNaN(item.unitPrice) || item.unitPrice <= 0) {
      throw new Error(`Invalid unitPrice for item ${index}`);
    }
    if (item.quantity !== undefined && (typeof item.quantity !== 'number' || item.quantity <= 0)) {
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

  const invoiceDate = body.invoiceDate ?? isoDateTodayUTC();
  const dueDate = body.dueDate ?? addDaysUtc(invoiceDate, 7);
  const currency = body.currency ?? 'USD';

  const items = body.items.map((item) => ({
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
    items,
    memo: body.memo ?? null,
  };

  try {
    const data = await waveGraphQLFetch<InvoiceCreateResult>(CREATE_INVOICE_MUTATION, { input });
    const result = data.invoiceCreate;

    if (!result.didSucceed || result.inputErrors.length > 0 || !result.invoice) {
      const inputErrors = result.inputErrors.map((e) => e.message);
      console.error('Wave invoiceCreate failed', inputErrors);
      return NextResponse.json(
        {
          error: 'Wave invoiceCreate failed',
          inputErrors,
        },
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
        total: invoice.total?.value ?? null,
        amountDue: invoice.amountDue?.value ?? null,
        currency: invoice.total?.currency?.code ?? null,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        viewUrl: invoice.viewUrl,
        pdfUrl: invoice.pdfUrl ?? null,
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
