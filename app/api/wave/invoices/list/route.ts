import { NextRequest, NextResponse } from 'next/server';
import { waveGraphQLFetch } from '../../../../../lib/waveClient';
import { BusinessKey, getBusinessIdFromKey } from '../../../../../lib/businessSelector';

interface ListInvoicesRequestBody {
  businessKey?: BusinessKey;
  status?: 'DRAFT' | 'APPROVED' | 'SENT' | 'PAID' | 'OVERDUE';
  customerSearch?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

interface InvoiceListItem {
  id: string;
  invoiceNumber: string | null;
  status: string;
  createdAt: string;
  dueDate: string | null;
  totalAmount: number;
  totalCurrency: string;
  amountDue: number;
  customerName: string | null;
}

interface ListInvoicesResponseBody {
  businessKey: BusinessKey;
  businessId: string;
  pageInfo: {
    currentPage: number;
    totalPages: number;
    totalCount: number;
  };
  invoices: InvoiceListItem[];
}

interface ListInvoicesQueryResult {
  business: {
    id: string;
    invoices: {
      pageInfo: {
        currentPage: number;
        totalPages: number;
        totalCount: number;
      };
      edges: Array<{
        node: {
          id: string;
          createdAt: string;
          dueDate: string | null;
          status: string;
          invoiceNumber: string | null;
          total: {
            amount: number;
            currency: { code: string } | null;
          } | null;
          amountDue: {
            amount: number;
            currency: { code: string } | null;
          } | null;
          customer: {
            id: string;
            name: string | null;
          } | null;
        };
      }>;
    } | null;
  } | null;
}

const LIST_INVOICES_QUERY = /* GraphQL */ `
  query ListInvoices(
    $businessId: ID!
    $page: Int
    $pageSize: Int
    $status: InvoiceStatus
    $customerSearch: String
    $startDate: Date
    $endDate: Date
  ) {
    business(id: $businessId) {
      id
      invoices(
        page: $page
        pageSize: $pageSize
        status: $status
        customerSearch: $customerSearch
        createdAtStart: $startDate
        createdAtEnd: $endDate
      ) {
        pageInfo {
          currentPage
          totalPages
          totalCount
        }
        edges {
          node {
            id
            createdAt
            dueDate
            status
            invoiceNumber
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
            }
          }
        }
      }
    }
  }
`;

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

/**
 * Lists invoices from Wave for a given business, applying optional filters like status and dates.
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

  let body: ListInvoicesRequestBody;
  try {
    body = (await req.json()) as ListInvoicesRequestBody;
  } catch (error) {
    console.error('Invalid JSON body for invoice listing', error);
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { businessKey, status, customerSearch, fromDate, toDate } = body;
  const validKeys: BusinessKey[] = ['manna', 'bako', 'socialion'];

  if (!businessKey || !validKeys.includes(businessKey)) {
    return NextResponse.json({ error: 'Invalid or missing businessKey' }, { status: 400 });
  }

  const limitFromBody = typeof body.limit === 'number' ? body.limit : undefined;
  const pageSize = Math.min(Math.max(limitFromBody ?? 20, 1), 100);

  let businessId: string;
  try {
    businessId = getBusinessIdFromKey(businessKey);
  } catch (error) {
    console.error('Missing business ID environment variable', error);
    return NextResponse.json({ error: 'Failed to fetch invoices from Wave' }, { status: 500 });
  }

  const variables = {
    businessId,
    page: 1,
    pageSize,
    status,
    customerSearch: customerSearch || undefined,
    startDate: fromDate || undefined,
    endDate: toDate || undefined,
  };

  try {
    const data = await waveGraphQLFetch<ListInvoicesQueryResult>(LIST_INVOICES_QUERY, variables);
    const invoicesData = data.business?.invoices;

    if (!invoicesData) {
      return NextResponse.json(
        { error: 'Failed to fetch invoices from Wave' },
        { status: 500 }
      );
    }

    const pageInfo = invoicesData.pageInfo;

    const invoices: InvoiceListItem[] = invoicesData.edges.map(({ node }) => ({
      id: node.id,
      invoiceNumber: node.invoiceNumber ?? null,
      status: node.status,
      createdAt: node.createdAt,
      dueDate: node.dueDate ?? null,
      totalAmount: Number(node.total?.amount ?? 0),
      totalCurrency: node.total?.currency?.code ?? '',
      amountDue: Number(node.amountDue?.amount ?? 0),
      customerName: node.customer?.name ?? null,
    }));

    const responseBody: ListInvoicesResponseBody = {
      businessKey,
      businessId,
      pageInfo: {
        currentPage: pageInfo.currentPage,
        totalPages: pageInfo.totalPages,
        totalCount: pageInfo.totalCount,
      },
      invoices,
    };

    return NextResponse.json(responseBody, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch invoices from Wave', error);
    return NextResponse.json({ error: 'Failed to fetch invoices from Wave' }, { status: 500 });
  }
}
