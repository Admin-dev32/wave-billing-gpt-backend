import { NextRequest, NextResponse } from 'next/server';
import { waveGraphQLFetch } from '../../../../../lib/waveClient';
import { BusinessKey, getBusinessIdFromKey } from '../../../../../lib/businessSelector';

interface BaseCustomerRequestBody {
  businessKey?: BusinessKey;
}

interface ListCustomersRequestBody extends BaseCustomerRequestBody {
  search?: string;
  page?: number;
  pageSize?: number;
}

interface ListCustomersQueryResult {
  business: {
    id: string;
    customers: {
      pageInfo: {
        currentPage: number;
        totalPages: number;
        totalCount: number;
      };
      edges: Array<{
        node: {
          id: string;
          name: string;
          email: string | null;
          phone: { number: string | null } | null;
        };
      }>;
    } | null;
  } | null;
}

interface ListCustomersResponseBody {
  businessKey: BusinessKey;
  businessId: string;
  pageInfo: {
    currentPage: number;
    totalPages: number;
    totalCount: number;
  };
  customers: Array<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
  }>;
}

const LIST_CUSTOMERS_QUERY = /* GraphQL */ `
  query ListCustomers($businessId: ID!, $page: Int, $pageSize: Int) {
    business(id: $businessId) {
      id
      customers(page: $page, pageSize: $pageSize) {
        pageInfo {
          currentPage
          totalPages
          totalCount
        }
        edges {
          node {
            id
            name
            email
            phone {
              number
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

  let body: ListCustomersRequestBody;
  try {
    body = (await req.json()) as ListCustomersRequestBody;
  } catch (error) {
    console.error('Invalid JSON body for list customers', error);
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const validKeys: BusinessKey[] = ['manna', 'bako', 'socialion'];
  if (!body.businessKey || !validKeys.includes(body.businessKey)) {
    return NextResponse.json({ error: 'Invalid businessKey' }, { status: 400 });
  }

  const page = typeof body.page === 'number' && body.page >= 1 ? body.page : 1;
  const pageSize =
    typeof body.pageSize === 'number' && body.pageSize >= 1 && body.pageSize <= 100
      ? body.pageSize
      : 50;

  let businessId: string;
  try {
    businessId = getBusinessIdFromKey(body.businessKey);
  } catch (error) {
    console.error('Invalid business key or missing environment variable', error);
    return NextResponse.json({ error: 'Invalid businessKey' }, { status: 400 });
  }

  const variables = { businessId, page, pageSize };

  try {
    const data = await waveGraphQLFetch<ListCustomersQueryResult>(LIST_CUSTOMERS_QUERY, variables);
    const customersData = data.business?.customers;

    if (!customersData) {
      console.error('Wave returned no customers payload', data);
      return NextResponse.json(
        { error: 'Failed to list customers from Wave' },
        { status: 500 }
      );
    }

    const edges = Array.isArray(customersData.edges) ? customersData.edges : [];
    const customersMapped = edges.map(({ node }) => ({
      id: node.id,
      name: node.name,
      email: node.email ?? null,
      phone: node.phone?.number ?? null,
    }));

    const search = typeof body.search === 'string' ? body.search.trim().toLowerCase() : '';
    const filteredCustomers = search
      ? customersMapped.filter((customer) => {
          const haystack = `${customer.name ?? ''} ${customer.email ?? ''} ${customer.phone ?? ''}`
            .toLowerCase();
          return haystack.includes(search);
        })
      : customersMapped;

    const response: ListCustomersResponseBody = {
      businessKey: body.businessKey,
      businessId,
      pageInfo: customersData.pageInfo,
      customers: filteredCustomers,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Failed to list customers from Wave', error);
    return NextResponse.json(
      { error: 'Failed to list customers from Wave' },
      { status: 500 }
    );
  }
}
