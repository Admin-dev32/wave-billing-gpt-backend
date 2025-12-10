import { NextRequest, NextResponse } from 'next/server';
import { waveGraphQLFetch } from '../../../../../lib/waveClient';
import { BusinessKey, getBusinessIdFromKey } from '../../../../../lib/businessSelector';

interface ListInvoicesRequestBody {
  businessKey?: BusinessKey;
  status?: string;
  page?: number;
  pageSize?: number;
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
          modifiedAt: string;
          status: string;
          invoiceNumber: string | null;
          invoiceDate: string | null;
          dueDate: string | null;
          viewUrl: string | null;
          customer: {
            id: string;
            name: string;
          } | null;
          currency: {
            code: string;
          } | null;
          total: {
            value: number;
            currency: {
              code: string;
              symbol: string;
            } | null;
          } | null;
          amountDue: {
            value: number;
            currency: {
              code: string;
              symbol: string;
            } | null;
          } | null;
        };
      }>;
    } | null;
  } | null;
}

interface InvoiceListItem {
  id: string;
  invoiceNumber: string | null;
  status: string;
  invoiceDate: string | null;
  dueDate: string | null;
  total: number;
  amountDue: number;
  currency: string | null;
  customerName: string | null;
  viewUrl: string | null;
}

interface ListInvoicesResponseBody {
  businessKey: BusinessKey;
  businessId: string;
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  invoices: InvoiceListItem[];
}

const LIST_INVOICES_QUERY = /* GraphQL */ `
  query ListInvoices($businessId: ID!, $page: Int!, $pageSize: Int!, $status: InvoiceStatus) {
    business(id: $businessId) {
      id
      invoices(page: $page, pageSize: $pageSize, status: $status) {
        pageInfo {
          currentPage
          totalPages
          totalCount
        }
        edges {
          node {
            id
            createdAt
            modifiedAt
            status
            invoiceNumber
            invoiceDate
            dueDate
            viewUrl
            customer {
              id
              name
            }
            currency {
              code
            }
            total {
              value
              currency {
                symbol
                code
              }
            }
            amountDue {
              value
              currency {
                symbol
                code
              }
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
 * Lists invoices from Wave for a given business with optional status filtering and pagination.
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

  const { businessKey, status } = body;
  const validKeys: BusinessKey[] = ['manna', 'bako', 'socialion'];

  if (!businessKey || !validKeys.includes(businessKey)) {
    return NextResponse.json({ error: 'Invalid businessKey' }, { status: 400 });
  }

  const page = typeof body.page === 'number' ? body.page : 1;
  const pageSize = typeof body.pageSize === 'number' ? body.pageSize : 50;

  if (page < 1 || pageSize < 1) {
    return NextResponse.json({ error: 'page and pageSize must be greater than or equal to 1' }, { status: 400 });
  }

  let businessId: string;
  try {
    businessId = getBusinessIdFromKey(businessKey);
  } catch (error) {
    console.error('Invalid business key or missing environment variable', error);
    return NextResponse.json({ error: 'Invalid businessKey' }, { status: 400 });
  }

  const variables = {
    businessId,
    page,
    pageSize,
    status: status ? status : undefined,
  };

  try {
    const data = await waveGraphQLFetch<ListInvoicesQueryResult>(LIST_INVOICES_QUERY, variables);

    const business = data.business;
    if (!business) {
      return NextResponse.json({ error: 'Invalid businessKey' }, { status: 400 });
    }

    const invoicesData = business.invoices;
    if (!invoicesData) {
      const emptyResponse: ListInvoicesResponseBody = {
        businessKey,
        businessId,
        page,
        pageSize,
        totalCount: 0,
        totalPages: 0,
        invoices: [],
      };
      return NextResponse.json(emptyResponse, { status: 200 });
    }

    const invoices: InvoiceListItem[] = invoicesData.edges.map(({ node }) => ({
      id: node.id,
      invoiceNumber: node.invoiceNumber ?? null,
      status: node.status,
      invoiceDate: node.invoiceDate ?? null,
      dueDate: node.dueDate ?? null,
      total: node.total?.value ?? 0,
      amountDue: node.amountDue?.value ?? 0,
      currency: node.currency?.code ?? node.total?.currency?.code ?? null,
      customerName: node.customer?.name ?? null,
      viewUrl: node.viewUrl ?? null,
    }));

    const responseBody: ListInvoicesResponseBody = {
      businessKey,
      businessId,
      page,
      pageSize,
      totalCount: invoicesData.pageInfo.totalCount,
      totalPages: invoicesData.pageInfo.totalPages,
      invoices,
    };

    return NextResponse.json(responseBody, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch invoices from Wave', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to fetch invoices from Wave', details: message },
      { status: 500 }
    );
  }
}
