/**
 * Typed helpers to talk to the Wave public GraphQL endpoint without external clients.
 */

export interface WaveGraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

const WAVE_GRAPHQL_ENDPOINT = 'https://gql.waveapps.com/graphql/public';

/**
 * Executes a typed GraphQL request against Wave's public endpoint using the configured bearer token.
 */
export async function waveGraphQLFetch<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const token = process.env.WAVE_ACCESS_TOKEN;

  if (!token) {
    throw new Error('WAVE_ACCESS_TOKEN is not set');
  }

  const response = await fetch(WAVE_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Wave GraphQL request failed: ${response.status} ${response.statusText} - ${errorText || 'No response body'}`
    );
  }

  const json = (await response.json()) as WaveGraphQLResponse<T>;

  if (json.errors?.length) {
    const firstMessage = json.errors[0]?.message ?? 'Unknown error';
    throw new Error(`Wave GraphQL error: ${firstMessage}`);
  }

  if (json.data === undefined) {
    throw new Error('Wave GraphQL response missing data');
  }

  return json.data;
}

/**
 * Convenience helper to manually verify access to the Wave API by listing businesses.
 * Useful for smoke-testing credentials in a REPL or temporary script.
 */
export async function testListBusinesses() {
  interface BusinessesQueryResult {
    businesses: {
      edges: Array<{
        node: {
          id: string;
          name: string;
          isActive: boolean;
        };
      }>;
    };
  }

  const query = /* GraphQL */ `
    query ListBusinesses {
      businesses {
        edges {
          node {
            id
            name
            isActive
          }
        }
      }
    }
  `;

  return waveGraphQLFetch<BusinessesQueryResult>(query);
}
