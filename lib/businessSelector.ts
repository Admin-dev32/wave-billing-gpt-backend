/**
 * Helpers to map friendly business keys to the configured Wave business IDs.
 */
export type BusinessKey = 'manna' | 'bako' | 'socialion';

function readEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set`);
  }

  return value;
}

/**
 * Returns the Wave business ID for a given friendly key, validating required env vars.
 */
export function getBusinessIdFromKey(key: BusinessKey): string {
  switch (key) {
    case 'manna':
      return readEnv('WAVE_BUSINESS_ID_MANNA');
    case 'bako':
      return readEnv('WAVE_BUSINESS_ID_BAKO');
    case 'socialion':
      return readEnv('WAVE_BUSINESS_ID_SOCIALION');
    default: {
      // Exhaustiveness guard for future keys.
      const exhaustiveCheck: never = key;
      throw new Error(`Unknown business key: ${exhaustiveCheck}`);
    }
  }
}

/**
 * Attempts to infer the business key from a free-form string (e.g., user-provided text).
 */
export function resolveBusinessKeyFromName(raw: string): BusinessKey | null {
  const normalized = raw.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (normalized.includes('manna')) {
    return 'manna';
  }

  if (normalized.includes('bako')) {
    return 'bako';
  }

  if (normalized.includes('socialion') || normalized.includes('socia')) {
    return 'socialion';
  }

  return null;
}
