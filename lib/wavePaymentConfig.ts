import type { BusinessKey } from './businessSelector';

export interface WavePaymentConfig {
  anchorAccountId: string;
  salesAccountId: string;
}

function readEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set`);
  }

  return value;
}

export function getWavePaymentConfig(key: BusinessKey): WavePaymentConfig {
  switch (key) {
    case 'manna':
      return {
        anchorAccountId: readEnv('WAVE_ANCHOR_ACCOUNT_ID_MANNA'),
        salesAccountId: readEnv('WAVE_SALES_ACCOUNT_ID_MANNA'),
      };
    case 'bako':
      return {
        anchorAccountId: readEnv('WAVE_ANCHOR_ACCOUNT_ID_BAKO'),
        salesAccountId: readEnv('WAVE_SALES_ACCOUNT_ID_BAKO'),
      };
    case 'socialion':
      return {
        anchorAccountId: readEnv('WAVE_ANCHOR_ACCOUNT_ID_SOCIALION'),
        salesAccountId: readEnv('WAVE_SALES_ACCOUNT_ID_SOCIALION'),
      };
    default: {
      const exhaustiveCheck: never = key;
      throw new Error(`Unknown business key: ${exhaustiveCheck}`);
    }
  }
}
