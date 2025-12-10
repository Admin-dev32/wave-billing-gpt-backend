import { NextRequest, NextResponse } from 'next/server';
import { BusinessKey, getBusinessIdFromKey } from '../../../../../lib/businessSelector';
import { waveGraphQLFetch } from '../../../../../lib/waveClient';

interface BaseProductRequestBody {
  businessKey?: BusinessKey;
}

interface UpdateProductRequestBody extends BaseProductRequestBody {
  productId?: string;
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

interface ProductUpdateResult {
  productUpdate: {
    didSucceed: boolean;
    inputErrors: Array<{
      code: string;
      message: string;
      path: string[];
    }>;
    product: ProductSummary | null;
  } | null;
}

interface UpdateProductResponseBody {
  businessKey: BusinessKey;
  businessId: string;
  product: ProductSummary;
}

const PRODUCT_UPDATE_MUTATION = /* GraphQL */ `
  mutation ProductUpdate($input: ProductUpdateInput!) {
    productUpdate(input: $input) {
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

  let body: UpdateProductRequestBody;
  try {
    body = (await req.json()) as UpdateProductRequestBody;
  } catch (error) {
    console.error('Invalid JSON body for product update', error);
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const validKeys: BusinessKey[] = ['manna', 'bako', 'socialion'];
  if (!body.businessKey || !validKeys.includes(body.businessKey)) {
    return NextResponse.json({ error: 'Invalid businessKey' }, { status: 400 });
  }

  if (!body.productId || typeof body.productId !== 'string' || body.productId.trim().length === 0) {
    return NextResponse.json({ error: 'productId is required' }, { status: 400 });
  }

  const hasUpdatableField =
    typeof body.name === 'string' ||
    typeof body.description === 'string' ||
    typeof body.unitPrice === 'number' ||
    typeof body.isSold === 'boolean' ||
    typeof body.isBought === 'boolean';

  if (!hasUpdatableField) {
    return NextResponse.json(
      { error: 'At least one updatable field must be provided' },
      { status: 400 }
    );
  }

  if (typeof body.unitPrice === 'number' && (!Number.isFinite(body.unitPrice) || body.unitPrice < 0)) {
    return NextResponse.json({ error: 'unitPrice must be a non-negative number' }, { status: 400 });
  }

  let businessId: string;
  try {
    businessId = getBusinessIdFromKey(body.businessKey);
  } catch (error) {
    console.error('Invalid business key or missing environment variable', error);
    return NextResponse.json({ error: 'Invalid businessKey' }, { status: 400 });
  }

  const input: Record<string, unknown> = {
    businessId,
    id: body.productId.trim(),
  };

  if (typeof body.name === 'string') {
    input.name = body.name;
  }
  if (typeof body.description === 'string') {
    input.description = body.description;
  }
  if (typeof body.unitPrice === 'number') {
    input.unitPrice = body.unitPrice;
  }
  if (typeof body.isSold === 'boolean') {
    input.isSold = body.isSold;
  }
  if (typeof body.isBought === 'boolean') {
    input.isBought = body.isBought;
  }

  try {
    const result = await waveGraphQLFetch<ProductUpdateResult>(PRODUCT_UPDATE_MUTATION, { input });
    const productUpdate = result.productUpdate;
    const inputErrors = productUpdate?.inputErrors ?? [];

    if (!productUpdate || !productUpdate.didSucceed || inputErrors.length > 0 || !productUpdate.product) {
      console.error('Wave productUpdate failed', JSON.stringify(result, null, 2));
      return NextResponse.json(
        {
          error: 'Wave productUpdate failed',
          inputErrors,
        },
        { status: 500 }
      );
    }

    const response: UpdateProductResponseBody = {
      businessKey: body.businessKey,
      businessId,
      product: productUpdate.product,
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
