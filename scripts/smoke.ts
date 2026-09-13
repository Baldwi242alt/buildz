import { parseArgs } from 'node:util';
import { routes } from '../apps/api/src/contract.js';
const { values } = parseArgs({
  options: { api: { type: 'string' }, app: { type: 'string' } },
});
const origin = (value: string | undefined, name: string) => {
  if (!value) throw new Error(`Supply --${name} <origin>.`);
  const u = new URL(value);
  if (
    !['http:', 'https:'].includes(u.protocol) ||
    u.origin !== value ||
    u.username ||
    u.password
  )
    throw new Error(
      `--${name} must be an HTTP(S) origin without credentials or trailing slash.`,
    );
  return value;
};
const api = origin(values.api, 'api');
for (const path of [
  '/v1/health/live',
  '/v1/health/ready',
  '/v1/meta',
  '/v1/public/projects',
]) {
  const response = await fetch(api + path, {
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}.`);
  const body = await response.json();
  const route = routes.find((r) => r.path === path && r.method === 'GET')!;
  if (!route.response(body))
    throw new Error(`${path} does not match the current contract.`);
  console.log(`PASS ${path}`);
}
const privateResponse = await fetch(api + '/v1/me', {
  signal: AbortSignal.timeout(10000),
});
if (privateResponse.status !== 401)
  throw new Error('Private identity route must reject an anonymous request.');
console.log('PASS anonymous private-read rejection');
if (values.app) {
  const app = origin(values.app, 'app');
  for (const path of ['/', '/showcase/00000000-0000-4000-8000-000000000000']) {
    const response = await fetch(app + path, {
      signal: AbortSignal.timeout(15000),
    });
    if (
      !response.ok ||
      !response.headers.get('content-type')?.includes('text/html')
    )
      throw new Error(
        `Frontend route ${path} did not serve HTML; check SPA rewrites.`,
      );
    console.log(`PASS frontend ${path}`);
  }
}
console.log(
  'Read-only smoke checks passed. Run authenticated multi-user browser journeys separately.',
);
