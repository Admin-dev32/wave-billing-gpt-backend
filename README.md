# wave-billing-gpt-backend

Lightweight Vercel-ready Next.js (App Router) backend exposing API routes for Wave + GPT integrations.

## Development

Install dependencies and start the dev server:

```bash
npm install
npm run dev
```

## Environment variables

The API expects the following variables to be provided by your environment (e.g., Vercel project settings or a local `.env` file):

- `WAVE_ACCESS_TOKEN`
- `WAVE_BUSINESS_ID_MANNA`
- `WAVE_BUSINESS_ID_BAKO`
- `WAVE_BUSINESS_ID_SOCIALION`
- `INTERNAL_API_SECRET`

## Health check

`GET /api/health` responds with service metadata when the `x-internal-secret` header matches `INTERNAL_API_SECRET`.
