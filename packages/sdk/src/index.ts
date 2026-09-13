import createClient from 'openapi-fetch';
import type { paths } from './schema.js';
export type { paths, components } from './schema.js';

/** baseUrl is the API origin, without /v1. Access tokens are never stored here. */
export function createBuildZClient(options: {
  baseUrl: string;
  getAccessToken: () => string | null | Promise<string | null>;
  fetch?: typeof globalThis.fetch;
}) {
  const client = createClient<paths>({ baseUrl: options.baseUrl, fetch: options.fetch });
  client.use({ async onRequest({ request }) {
    const token = await options.getAccessToken();
    if (token) request.headers.set('Authorization', `Bearer ${token}`);
    return request;
  } });
  return client;
}
