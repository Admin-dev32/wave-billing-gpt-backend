import { NextRequest, NextResponse } from 'next/server';
import { waveGraphQLFetch } from '../../../../../lib/waveClient';
import { BusinessKey, getBusinessIdFromKey } from '../../../../../lib/businessSelector';

interface BaseCustomerRequestBody {
  businessKey?: BusinessKey;
}

interface EnsureCustomerRequestBody extends BaseCustomerRequestBody {
  name?: string;
  email?: string;
  phone?: string;
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

interface CustomerCreateResult {
  customerCreate: {
    didSucceed: boolean;
    inputErrors: Array<{
      code: string;
      message: string;
      path: string[];
    }> | null;
    customer: {
      id: string;
      name: string;
      email: string | null;
      phone: { number: string | null } | null;
    } | null;
  } | null;
}

interface EnsureCustomerResponseBody {
  businessKey: BusinessKey;
  businessId: string;
  created: boolean;
  customer: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
  };
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

const CUSTOMER_CREATE_MUTATION = /* GraphQL */ `
  mutation CustomerCreate($input: CustomerCreateInput!) {
    customerCreate(input: $input) {
      didSucceed
      inputErrors {
        code
        message
        path
      }
      customer {
        id
        name
        email
        phone {
          number
        }
      }
    }
  }
`;

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function normalizeString(value?: string | null): string {
  return (value ?? '').trim();
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

  let body: EnsureCustomerRequestBody;
  try {
    body = (await req.json()) as EnsureCustomerRequestBody;
  } catch (error) {
    console.error('Invalid JSON body for ensure customer', error);
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const validKeys: BusinessKey[] = ['manna', 'bako', 'socialion'];
  if (!body.businessKey || !validKeys.includes(body.businessKey)) {
    return NextResponse.json({ error: 'Invalid businessKey' }, { status: 400 });
  }

  const nameInput = normalizeString(body.name);
  const emailInput = normalizeString(body.email);
  const phoneInput = normalizeString(body.phone);

  if (!nameInput && !emailInput) {
    return NextResponse.json({ error: 'Either name or email must be provided' }, { status: 400 });
  }

  let businessId: string;
  try {
    businessId = getBusinessIdFromKey(body.businessKey);
  } catch (error) {
    console.error('Invalid business key or missing environment variable', error);
    return NextResponse.json({ error: 'Invalid businessKey' }, { status: 400 });
  }

  const listVariables = { businessId, page: 1, pageSize: 200 };

  try {
    const listData = await waveGraphQLFetch<ListCustomersQueryResult>(LIST_CUSTOMERS_QUERY, listVariables);
    const customersData = listData.business?.customers;

    if (!customersData) {
      console.error('Wave returned no customers payload during ensure', listData);
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

    const normalizedEmail = emailInput.toLowerCase();
    const normalizedName = nameInput.toLowerCase();
    const normalizedPhone = phoneInput.toLowerCase();

    const existing = customersMapped.find((customer) => {
      const customerEmail = (customer.email ?? '').toLowerCase();
      const customerName = (customer.name ?? '').toLowerCase();
      const customerPhone = (customer.phone ?? '').toLowerCase();

      if (normalizedEmail && customerEmail === normalizedEmail) {
        return true;
      }

      if (normalizedName && customerName.includes(normalizedName)) {
        return true;
      }

      if (normalizedPhone && customerPhone.includes(normalizedPhone)) {
        return true;
      }

      return false;
    });

    if (existing) {
      const response: EnsureCustomerResponseBody = {
        businessKey: body.businessKey,
        businessId,
        created: false,
        customer: existing,
      };
      return NextResponse.json(response, { status: 200 });
    }

    const createInput: { businessId: string; name: string; email?: string | null; phone?: { number: string } } = {
      businessId,
      name: nameInput || emailInput,
    };

    if (emailInput) {
      createInput.email = emailInput;
    }

    if (phoneInput) {
      createInput.phone = { number: phoneInput };
    }

    const createResult = await waveGraphQLFetch<CustomerCreateResult>(
      CUSTOMER_CREATE_MUTATION,
      { input: createInput }
    );

    const customerCreate = createResult.customerCreate;
    const inputErrors = customerCreate?.inputErrors ?? [];

    if (!customerCreate?.didSucceed || !customerCreate.customer || inputErrors.length > 0) {
      console.error('Wave customerCreate failed', JSON.stringify(createResult, null, 2));
      return NextResponse.json(
        { error: 'Wave customerCreate failed', inputErrors },
        { status: 500 }
      );
    }

    const customer = customerCreate.customer;
    const response: EnsureCustomerResponseBody = {
      businessKey: body.businessKey,
      businessId,
      created: true,
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email ?? null,
        phone: customer.phone?.number ?? null,
      },
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Unexpected error in customers endpoint', error);
    const details = error instanceof Error ? error.message : undefined;
    return NextResponse.json(
      {
        error: 'Unexpected error in customers endpoint',
        details,
      },
      { status: 500 }
    );
  }
}
