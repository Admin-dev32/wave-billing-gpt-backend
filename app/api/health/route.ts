import { NextRequest, NextResponse } from 'next/server';

type HealthResponse = {
  ok: boolean;
  service: string;
  version: string;
};

const SERVICE_METADATA: HealthResponse = {
  ok: true,
  service: 'wave-billing-gpt-backend',
  version: '0.1.0',
};

export async function GET(request: NextRequest) {
  const expectedSecret = process.env.INTERNAL_API_SECRET;

  if (!expectedSecret) {
    console.error('INTERNAL_API_SECRET is not set');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Validate internal caller secret before responding.
  const providedSecret = request.headers.get('x-internal-secret');
  if (!providedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json(SERVICE_METADATA, { status: 200 });
}
