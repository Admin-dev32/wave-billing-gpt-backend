import { NextRequest, NextResponse } from 'next/server';
import { BusinessKey, getBusinessIdFromKey } from '../../../../../lib/businessSelector';
import { waveGraphQLFetch } from '../../../../../lib/waveClient';

interface BaseProductRequestBody {
  businessKey?: BusinessKey;
}

interface ListProductsRequestBody extends BaseProductRequestBody {
  search?: string;
  page?: number;
  pageSize?: number;
}

interface ProductSummary {
  id: string;
  name: string;
  description: string | null;
  isSold: boolean;
  isBought: boolean;
}

interface ListProductsResponseBody {
  businessKey: BusinessKey;
  businessId: string;
  pageInfo: {
    currentPage: number;
    totalPages: number;
    totalCount: number;
  };
  products: ProductSummary[];
}

interface ListProductsQueryResult {
  business: {
    id: string;
    products: {
      pageInfo: {
        currentPage: number;
        totalPages: number;
        totalCount: number;
      };
      edges: Array<{
        node: {
          id: string;
          name: string;
          description: string | null;
          isSold: boolean;
          isBought: boolean;
        };
      }>;
    } | null;
  } | null;
}

const LIST_PRODUCTS_QUERY = /* GraphQL */ `
  query ListProducts($businessId: ID!, $page: Int, $pageSize: Int) {
    business(id: $businessId) {
      id
      products(page: $page, pageSize: $pageSize) {
        pageInfo {
          currentPage
          totalPages
          totalCount
        }
        edges {
          node {
            id
            name
            description
            isSold
            isBought
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

  let body: ListProductsRequestBody;
  try {
    body = (await req.json()) as ListProductsRequestBody;
  } catch (error) {
    console.error('Invalid JSON body for product listing', error);
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const validKeys: BusinessKey[] = ['manna', 'bako', 'socialion'];
  if (!body.businessKey || !validKeys.includes(body.businessKey)) {
    return NextResponse.json({ error: 'Invalid businessKey' }, { status: 400 });
  }

  const page = typeof body.page === 'number' && body.page >= 1 ? body.page : 1;
  const pageSizeCandidate = typeof body.pageSize === 'number' ? body.pageSize : 50;
  const pageSize = Math.min(Math.max(pageSizeCandidate, 1), 100);

  let businessId: string;
  try {
    businessId = getBusinessIdFromKey(body.businessKey);
  } catch (error) {
    console.error('Invalid business key or missing environment variable', error);
    return NextResponse.json({ error: 'Invalid businessKey' }, { status: 400 });
  }

  try {
    const data = await waveGraphQLFetch<ListProductsQueryResult>(LIST_PRODUCTS_QUERY, {
      businessId,
      page,
      pageSize,
    });

    const productsData = data.business?.products;
    if (!data.business || !productsData) {
      return NextResponse.json({ error: 'Failed to list products from Wave' }, { status: 500 });
    }

    const search = typeof body.search === 'string' ? body.search.trim().toLowerCase() : '';
    const products = productsData.edges
      .map(({ node }) => node)
      .filter((product) => {
        if (!search) return true;
        const name = product.name?.toLowerCase() ?? '';
        const description = product.description?.toLowerCase() ?? '';
        return name.includes(search) || description.includes(search);
      })
      .map<ProductSummary>((product) => ({
        id: product.id,
        name: product.name,
        description: product.description,
        isSold: product.isSold,
        isBought: product.isBought,
      }));

    const response: ListProductsResponseBody = {
      businessKey: body.businessKey,
      businessId,
      pageInfo: {
        currentPage: productsData.pageInfo.currentPage,
        totalPages: productsData.pageInfo.totalPages,
        totalCount: products.length,
      },
      products,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Failed to list products from Wave', error);
    return NextResponse.json({ error: 'Failed to list products from Wave' }, { status: 500 });
  }
}
