import { NextRequest, NextResponse } from 'next/server';
import { BusinessKey, getBusinessIdFromKey } from '../../../../../lib/businessSelector';
import { waveGraphQLFetch } from '../../../../../lib/waveClient';

interface ApproveInvoiceRequestBody {
  businessKey?: BusinessKey;
  invoiceId?: string;
}

interface InvoiceApproveResult {
  invoiceApprove: {
    didSucceed: boolean;
    inputErrors: Array<{
      code: string;
      message: string;
      path: string[];
    }> | null;
    invoice: {
      id: string;
      invoiceNumber: string | null;
      status: string;
      invoiceDate: string | null;
      dueDate: string | null;
      viewUrl: string | null;
      pdfUrl: string | null;
      total: {
        value: string;
        currency: { code: string } | null;
      } | null;
      amountDue: {
        value: string;
        currency: { code: string } | null;
      } | null;
      customer: {
        id: string;
        name: string | null;
        email: string | null;
      } | null;
    } | null;
  } | null;
}

interface ApproveInvoiceResponseBody {
  businessKey: BusinessKey;
  businessId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  status: string;
  invoiceDate: string | null;
  dueDate: string | null;
  total: number | null;
  amountDue: number | null;
  currency: string | null;
  customerId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  viewUrl: string | null;
  pdfUrl: string | null;
}

const INVOICE_APPROVE_MUTATION = /* GraphQL */ `
  mutation InvoiceApprove($input: InvoiceApproveInput!) {
    invoiceApprove(input: $input) {
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
    let body: ApproveInvoiceRequestBody;
    try {
      body = (await req.json()) as ApproveInvoiceRequestBody;
    } catch (error) {
      console.error('Invalid JSON body for invoice approval', error);
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const validKeys: BusinessKey[] = ['manna', 'bako', 'socialion'];
    if (!body.businessKey || !validKeys.includes(body.businessKey)) {
      return NextResponse.json({ error: 'Invalid businessKey' }, { status: 400 });
    }

    if (!body.invoiceId || typeof body.invoiceId !== 'string' || !body.invoiceId.trim()) {
      return NextResponse.json({ error: 'invoiceId is required' }, { status: 400 });
    }

    let businessId: string;
    try {
      businessId = getBusinessIdFromKey(body.businessKey);
    } catch (error) {
      console.error('Invalid business key or missing business ID env var', error);
      return NextResponse.json({ error: 'Invalid businessKey' }, { status: 400 });
    }

    const input = {
      invoiceId: body.invoiceId,
    };

    const data = await waveGraphQLFetch<InvoiceApproveResult>(INVOICE_APPROVE_MUTATION, { input });
    const result = data.invoiceApprove;

    if (!result) {
      return NextResponse.json(
        { error: 'Wave invoiceApprove returned no result' },
        { status: 500 }
      );
    }

    const inputErrors = result.inputErrors ?? [];
    if (!result.didSucceed || inputErrors.length > 0) {
      console.error('Wave invoiceApprove failed', JSON.stringify(result, null, 2));
      return NextResponse.json(
        {
          error: 'Wave invoiceApprove failed',
          inputErrors,
        },
        { status: 500 }
      );
    }

    if (!result.invoice) {
      return NextResponse.json(
        { error: 'Wave invoiceApprove did not return an invoice' },
        { status: 500 }
      );
    }

    const inv = result.invoice;
    const total = inv.total ? Number(inv.total.value) : null;
    const amountDue = inv.amountDue ? Number(inv.amountDue.value) : null;
    const currency = inv.total?.currency?.code ?? inv.amountDue?.currency?.code ?? null;

    const response: ApproveInvoiceResponseBody = {
      businessKey: body.businessKey,
      businessId,
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber ?? null,
      status: inv.status,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      total,
      amountDue,
      currency,
      customerId: inv.customer?.id ?? null,
      customerName: inv.customer?.name ?? null,
      customerEmail: inv.customer?.email ?? null,
      viewUrl: inv.viewUrl ?? null,
      pdfUrl: inv.pdfUrl ?? null,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Unexpected error while approving invoice in Wave', error);
    return NextResponse.json(
      {
        error: 'Unexpected error while approving invoice in Wave',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
