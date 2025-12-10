import { NextRequest, NextResponse } from 'next/server';
import { waveGraphQLFetch } from '../../../../../lib/waveClient';
import { BusinessKey, getBusinessIdFromKey } from '../../../../../lib/businessSelector';

interface MonthlySummaryRequestBody {
  businessKey?: BusinessKey;
  year?: number;
  month?: number;
}

interface MonthlySummaryQueryResult {
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
          total: { value: number; currency: { code: string } | null } | null;
          amountDue: { value: number; currency: { code: string } | null } | null;
        };
      }>;
    } | null;
  } | null;
}

interface MonthlySummaryTotals {
  totalInvoiced: number;
  totalPaid: number;
  totalOutstanding: number;
}

interface MonthlySummaryCounts {
  totalInvoices: number;
  draftCount: number;
  approvedCount: number;
  sentCount: number;
  paidCount: number;
  overdueCount: number;
}

interface MonthlySummaryResponseBody {
  businessKey: BusinessKey;
  businessId: string;
  year: number;
  month: number;
  period: {
    startDate: string;
    endDate: string;
  };
  totals: MonthlySummaryTotals;
  counts: MonthlySummaryCounts;
  currency: string | null;
}

const MONTHLY_SUMMARY_QUERY = /* GraphQL */ `
  query MonthlyInvoicesSummary(
    $businessId: ID!,
    $page: Int,
    $pageSize: Int,
    $startDate: Date,
    $endDate: Date
  ) {
    business(id: $businessId) {
      id
      invoices(
        page: $page
        pageSize: $pageSize
        invoiceDateStart: $startDate
        invoiceDateEnd: $endDate
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
          }
        }
      }
    }
  }
`;

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Returns a monthly summary of invoices for a business, including totals and status counts.
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

  let body: MonthlySummaryRequestBody;
  try {
    body = (await req.json()) as MonthlySummaryRequestBody;
  } catch (error) {
    console.error('Invalid JSON body for monthly summary', error);
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { businessKey, year, month } = body;
  const validKeys: BusinessKey[] = ['manna', 'bako', 'socialion'];

  if (!businessKey || !validKeys.includes(businessKey)) {
    return NextResponse.json({ error: 'Invalid businessKey' }, { status: 400 });
  }

  if (typeof year !== 'number' || typeof month !== 'number') {
    return NextResponse.json({ error: 'year and month are required' }, { status: 400 });
  }

  if (month < 1 || month > 12) {
    return NextResponse.json(
      { error: 'Invalid month. Must be between 1 and 12' },
      { status: 400 }
    );
  }

  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  const startDate = formatDate(start);
  const endDate = formatDate(end);

  let businessId: string;
  try {
    businessId = getBusinessIdFromKey(businessKey);
  } catch (error) {
    console.error('Invalid business key or missing environment variable', error);
    return NextResponse.json({ error: 'Invalid businessKey' }, { status: 400 });
  }

  const variables = {
    businessId,
    page: 1,
    pageSize: 200,
    startDate,
    endDate,
  };

  try {
    const data = await waveGraphQLFetch<MonthlySummaryQueryResult>(
      MONTHLY_SUMMARY_QUERY,
      variables
    );

    const invoicesData = data.business?.invoices;
    if (!invoicesData) {
      return NextResponse.json(
        { error: 'Failed to fetch monthly invoices from Wave' },
        { status: 500 }
      );
    }

    const { edges } = invoicesData;
    const counts: MonthlySummaryCounts = {
      totalInvoices: edges.length,
      draftCount: 0,
      approvedCount: 0,
      sentCount: 0,
      paidCount: 0,
      overdueCount: 0,
    };

    const totals: MonthlySummaryTotals = {
      totalInvoiced: 0,
      totalPaid: 0,
      totalOutstanding: 0,
    };

    let currency: string | null = null;

    edges.forEach(({ node }) => {
      const totalAmount = node.total?.value ?? 0;
      const amountDue = node.amountDue?.value ?? 0;
      const paidAmount = totalAmount - amountDue;

      totals.totalInvoiced += totalAmount;
      totals.totalPaid += paidAmount;
      totals.totalOutstanding += amountDue;

      if (!currency && node.total?.currency?.code) {
        currency = node.total.currency.code;
      }

      switch (node.status) {
        case 'DRAFT':
          counts.draftCount += 1;
          break;
        case 'APPROVED':
          counts.approvedCount += 1;
          break;
        case 'SENT':
          counts.sentCount += 1;
          break;
        case 'PAID':
          counts.paidCount += 1;
          break;
        case 'OVERDUE':
          counts.overdueCount += 1;
          break;
        default:
          break;
      }
    });

    const response: MonthlySummaryResponseBody = {
      businessKey,
      businessId,
      year,
      month,
      period: {
        startDate,
        endDate,
      },
      totals,
      counts,
      currency,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch monthly invoices from Wave', error);
    const details = error instanceof Error ? error.message : undefined;
    return NextResponse.json(
      { error: 'Failed to fetch monthly invoices from Wave', details },
      { status: 500 }
    );
  }
}
