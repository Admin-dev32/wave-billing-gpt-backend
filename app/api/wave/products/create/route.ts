import { NextRequest, NextResponse } from 'next/server';
import { BusinessKey, getBusinessIdFromKey } from '../../../../../lib/businessSelector';
import { waveGraphQLFetch } from '../../../../../lib/waveClient';

interface BaseProductRequestBody {
  businessKey?: BusinessKey;
}

interface CreateProductRequestBody extends BaseProductRequestBody {
  name?: string;
  description?: string;
  unitPrice?: number;
  isSold?: boolean;
  isBought?: boolean;
}

interface ProductSummary {
  id: string;
  name: string;
  description: string | null;
  isSold: boolean;
  isBought: boolean;
}

interface ProductCreateResult {
  productCreate: {
    didSucceed: boolean;
    inputErrors: Array<{
      code: string;
      message: string;
      path: string[];
    }>;
    product: ProductSummary | null;
  } | null;
}

interface CreateProductResponseBody {
  businessKey: BusinessKey;
  businessId: string;
  product: ProductSummary;
}

const PRODUCT_CREATE_MUTATION = /* GraphQL */ `
  mutation ProductCreate($input: ProductCreateInput!) {
    productCreate(input: $input) {
      didSucceed
      inputErrors {
        code
        message
        path
      }
      product {
        id
        name
        description
        isSold
        isBought
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

  let body: CreateProductRequestBody;
  try {
    body = (await req.json()) as CreateProductRequestBody;
  } catch (error) {
    console.error('Invalid JSON body for product creation', error);
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const validKeys: BusinessKey[] = ['manna', 'bako', 'socialion'];
  if (!body.businessKey || !validKeys.includes(body.businessKey)) {
    return NextResponse.json({ error: 'Invalid businessKey' }, { status: 400 });
  }

  if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return NextResponse.json({ error: 'Product name is required' }, { status: 400 });
  }

  if (typeof body.unitPrice !== 'undefined') {
    if (typeof body.unitPrice !== 'number' || !Number.isFinite(body.unitPrice) || body.unitPrice < 0) {
      return NextResponse.json({ error: 'unitPrice must be a non-negative number' }, { status: 400 });
    }
  }

  let businessId: string;
  try {
    businessId = getBusinessIdFromKey(body.businessKey);
  } catch (error) {
    console.error('Invalid business key or missing environment variable', error);
    return NextResponse.json({ error: 'Invalid businessKey' }, { status: 400 });
  }

  const input = {
    businessId,
    name: body.name.trim(),
    description: body.description ?? null,
    isSold: body.isSold ?? true,
    isBought: body.isBought ?? false,
    unitPrice:
      typeof body.unitPrice === 'number' && Number.isFinite(body.unitPrice)
        ? body.unitPrice
        : null,
  };

  try {
    const result = await waveGraphQLFetch<ProductCreateResult>(PRODUCT_CREATE_MUTATION, { input });
    const productCreate = result.productCreate;
    const inputErrors = productCreate?.inputErrors ?? [];

    if (!productCreate || !productCreate.didSucceed || inputErrors.length > 0 || !productCreate.product) {
      console.error('Wave productCreate failed', JSON.stringify(result, null, 2));
      return NextResponse.json(
        {
          error: 'Wave productCreate failed',
          inputErrors,
        },
        { status: 500 }
      );
    }

    const response: CreateProductResponseBody = {
      businessKey: body.businessKey,
      businessId,
      product: productCreate.product,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Unexpected error in products endpoint', error);
    return NextResponse.json(
      {
        error: 'Unexpected error in products endpoint',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
