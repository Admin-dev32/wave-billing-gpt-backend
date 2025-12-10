import { NextRequest, NextResponse } from 'next/server';
import { waveGraphQLFetch } from '../../../../../lib/waveClient';
import { BusinessKey, getBusinessIdFromKey } from '../../../../../lib/businessSelector';

interface AddPaymentRequestBody {
  businessKey?: BusinessKey;
  invoiceId?: string;
  invoiceNumber?: string;
  amount?: number;
  paymentDate?: string;
  paymentMethod?: 'CASH' | 'ZELLE' | 'BANK_TRANSFER' | 'CARD';
  notes?: string;
}

interface InvoiceCustomerInfo {
  id: string | null;
  name: string | null;
  email: string | null;
}

interface InvoicePaymentInfo {
  id: string;
  amount: number;
  currency: string;
  createdAt: string;
  paymentMethod: string | null;
  notes: string | null;
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
  customer: InvoiceCustomerInfo;
  publicUrl: string | null;
}

interface AddPaymentResponseBody {
  businessKey: BusinessKey;
  businessId: string;
  payment: InvoicePaymentInfo;
  invoice: UpdatedInvoiceInfo;
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

interface AddPaymentMutationResult {
  invoicePaymentCreate: {
    didSucceed: boolean;
    inputErrors: Array<{ message: string; path?: string[]; code?: string }> | null;
    payment: {
      id: string;
      createdAt: string;
      notes: string | null;
      paymentMethod: string | null;
      invoice: {
        id: string;
      };
    } | null;
  } | null;
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

const ADD_PAYMENT_MUTATION = /* GraphQL */ `
  mutation AddInvoicePayment($input: InvoicePaymentCreateInput!) {
    invoicePaymentCreate(input: $input) {
      didSucceed
      inputErrors {
        message
        path
        code
      }
      payment {
        id
        createdAt
        notes
        paymentMethod
        invoice {
          id
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

/**
 * Registers a payment on an existing invoice in Wave. Supports lookup by invoice number or id.
 */
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
  try {
    businessId = getBusinessIdFromKey(body.businessKey as BusinessKey);
  } catch (error) {
    console.error('Missing business ID environment variable', error);
    return NextResponse.json({ error: 'Invalid or missing businessKey' }, { status: 400 });
  }

  const paymentDate = body.paymentDate || todayIsoDate();
  const paymentMethod = body.paymentMethod ?? 'CASH';

  try {
    const invoiceNode = await lookupInvoice(businessId, body.invoiceId, body.invoiceNumber);

    if (!invoiceNode) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

       const mutationInput = {
      // OJO: aquí ya no mandamos businessId, Wave debería inferirlo del invoice
      invoiceId: invoiceNode.id,
      // amount como Decimal (número simple)
      amount: body.amount as number,
      paymentDate,
      paymentMethod,
      // si no hay notas, mejor no mandar el campo
      ...(body.notes ? { notes: body.notes } : {}),
    };

       const mutationResult = await waveGraphQLFetch<AddPaymentMutationResult>(
      ADD_PAYMENT_MUTATION,
      { input: mutationInput }
    );

    const payload = mutationResult.invoicePaymentCreate;

    if (!payload?.didSucceed || !payload.payment) {
      const details = payload?.inputErrors?.map((err) => err.message) ?? ['Unknown error'];
      console.error('Failed to register payment in Wave', payload?.inputErrors);
      return NextResponse.json(
        { error: 'Failed to register payment in Wave', details },
        { status: 400 }
      );
    }

    // 1) Reconstruimos el objeto payment usando lo que sabemos
    const payment: InvoicePaymentInfo = {
      id: payload.payment.id,
      amount: body.amount as number, // ya sabemos cuánto pagaste
      // tomaremos la moneda luego del invoice actualizado
      currency: '',
      createdAt: payload.payment.createdAt,
      paymentMethod: payload.payment.paymentMethod,
      notes: payload.payment.notes ?? null,
    };

    // 2) Volvemos a leer el invoice actualizado usando la query que ya funciona
    const updatedInvoiceData = await waveGraphQLFetch<InvoiceLookupResult>(
      FIND_INVOICE_BY_ID_QUERY,
      {
        businessId,
        invoiceId: payload.payment.invoice.id,
      }
    );

    const updatedInvoiceNode = updatedInvoiceData.business?.invoice;
    if (!updatedInvoiceNode) {
      console.error('Payment created but failed to refetch updated invoice', updatedInvoiceData);
      return NextResponse.json(
        { error: 'Payment created but failed to refetch updated invoice' },
        { status: 500 }
      );
    }

    const invoice = mapInvoiceNode(updatedInvoiceNode);

    // ahora sí podemos rellenar la currency del payment
    payment.currency = invoice.totalCurrency || 'USD';

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
