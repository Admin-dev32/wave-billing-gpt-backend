import { NextRequest, NextResponse } from 'next/server';
import { BusinessKey, getBusinessIdFromKey } from '../../../../../lib/businessSelector';
import { waveGraphQLFetch } from '../../../../../lib/waveClient';

interface CreateTransactionRequestBody {
  businessKey?: BusinessKey;
  externalId?: string;
  date?: string;
  description?: string;
  amount?: number;
  direction?: 'DEPOSIT' | 'WITHDRAWAL';
  balanceDirection?: 'INCREASE' | 'DECREASE';
  anchorAccountId?: string;
  lineItemAccountId?: string;
}

interface MoneyTransactionCreateResult {
  moneyTransactionCreate: {
    didSucceed: boolean;
    inputErrors: Array<{ path: string[]; message: string; code: string }> | null;
    transaction: { id: string } | null;
  } | null;
}

const MONEY_TRANSACTION_CREATE_MUTATION = /* GraphQL */ `
  mutation MoneyTransactionCreate($input: MoneyTransactionCreateInput!) {
    moneyTransactionCreate(input: $input) {
      didSucceed
      inputErrors {
        path
        message
        code
      }
      transaction {
        id
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

function getAnchorAccountIdFromEnv(key: BusinessKey): string {
  const envName =
    key === 'manna'
      ? 'WAVE_ANCHOR_ACCOUNT_ID_MANNA'
      : key === 'bako'
      ? 'WAVE_ANCHOR_ACCOUNT_ID_BAKO'
      : 'WAVE_ANCHOR_ACCOUNT_ID_SOCIALION';
  const value = process.env[envName];
  if (!value) {
    throw new Error(`Missing anchor account env var for ${key}`);
  }
  return value;
}

function getLineItemAccountIdFromEnv(key: BusinessKey): string {
  const envName =
    key === 'manna'
      ? 'WAVE_LINE_ITEM_ACCOUNT_ID_MANNA'
      : key === 'bako'
      ? 'WAVE_LINE_ITEM_ACCOUNT_ID_BAKO'
      : 'WAVE_LINE_ITEM_ACCOUNT_ID_SOCIALION';
  const value = process.env[envName];
  if (!value) {
    throw new Error(`Missing line item account env var for ${key}`);
  }
  return value;
}

export async function POST(req: NextRequest) {
  try {
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

    let body: CreateTransactionRequestBody;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const businessKey = body.businessKey;
    if (businessKey !== 'manna' && businessKey !== 'bako' && businessKey !== 'socialion') {
      return NextResponse.json({ error: 'Invalid businessKey' }, { status: 400 });
    }

    const amount = typeof body.amount === 'number' ? body.amount : NaN;
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 });
    }

    const direction = body.direction ?? 'DEPOSIT';
    if (direction !== 'DEPOSIT' && direction !== 'WITHDRAWAL') {
      return NextResponse.json({ error: 'direction must be DEPOSIT or WITHDRAWAL' }, { status: 400 });
    }

    const balanceDirection = body.balanceDirection ?? 'INCREASE';
    if (balanceDirection !== 'INCREASE' && balanceDirection !== 'DECREASE') {
      return NextResponse.json({ error: 'balanceDirection must be INCREASE or DECREASE' }, { status: 400 });
    }

    const description = (body.description ?? 'API Transaction').trim() || 'API Transaction';
    const dateValue = body.date?.trim() || formatDate(new Date());
    const externalId = body.externalId?.trim();

    let businessId: string;
    try {
      businessId = getBusinessIdFromKey(businessKey);
    } catch {
      return NextResponse.json({ error: 'Invalid businessKey' }, { status: 400 });
    }

    const anchorAccountId =
      (body.anchorAccountId && body.anchorAccountId.trim()) || getAnchorAccountIdFromEnv(businessKey);
    const lineItemAccountId =
      (body.lineItemAccountId && body.lineItemAccountId.trim()) || getLineItemAccountIdFromEnv(businessKey);

    const input = {
      businessId,
      externalId: externalId || undefined,
      date: dateValue,
      description,
      anchor: {
        accountId: anchorAccountId,
        amount,
        direction,
      },
      lineItems: [
        {
          accountId: lineItemAccountId,
          amount,
          balance: balanceDirection,
        },
      ],
    } as const;

    const data = await waveGraphQLFetch<MoneyTransactionCreateResult>(
      MONEY_TRANSACTION_CREATE_MUTATION,
      { input }
    );

    const result = data.moneyTransactionCreate;
    if (!result) {
      return NextResponse.json(
        { error: 'Wave moneyTransactionCreate returned no result' },
        { status: 500 }
      );
    }

    const inputErrors = result.inputErrors ?? [];
    if (!result.didSucceed || inputErrors.length > 0 || !result.transaction) {
      console.error('Wave moneyTransactionCreate failed', JSON.stringify(result, null, 2));
      return NextResponse.json(
        {
          error: 'Wave moneyTransactionCreate failed',
          inputErrors,
        },
        { status: 400 }
      );
    }

    const response = {
      businessKey,
      businessId,
      transaction: {
        id: result.transaction.id,
        externalId: externalId ?? null,
        date: dateValue,
        description,
        amount,
        direction,
        balanceDirection,
        anchorAccountId,
        lineItemAccountId,
      },
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Unexpected error while creating money transaction in Wave', error);
    return NextResponse.json(
      {
        error: 'Unexpected error while creating money transaction in Wave',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
