import { z } from 'zod';
const httpUrl = z.string().url().refine(s => ['http:', 'https:'].includes(new URL(s).protocol));
const Env = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3001),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  DATABASE_URL: z.string().min(1), DATABASE_SSL: z.enum(['true','false']).default('false'),
  AUTH_ISSUER: httpUrl, AUTH_JWKS_URL: httpUrl, AUTH_USERINFO_URL: httpUrl,
  AUTH_AUDIENCE: z.string().default('authenticated'), AUTH_PUBLISHABLE_KEY: z.string().min(1),
  CORS_ORIGINS: z.string().min(1), APP_ORIGIN: httpUrl,
});
export type Config = z.infer<typeof Env>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = Env.safeParse(env);
  if (!result.success) throw new Error(`Invalid configuration: ${result.error.issues.map(i => i.path.join('.')).join(', ')}`);
  const c = result.data;
  for (const origin of c.CORS_ORIGINS.split(',')) {
    if (new URL(origin).origin !== origin) throw new Error('CORS_ORIGINS must contain exact origins without trailing slashes.');
  }
  if (c.NODE_ENV === 'production') {
    for (const value of [c.AUTH_ISSUER,c.AUTH_JWKS_URL,c.AUTH_USERINFO_URL,c.APP_ORIGIN,...c.CORS_ORIGINS.split(',')]) {
      if (new URL(value).protocol !== 'https:' || ['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname))
        throw new Error('Hosted configuration requires HTTPS non-loopback URLs.');
    }
    if (c.DATABASE_SSL !== 'true') throw new Error('Hosted database connections require verified TLS.');
  }
  return c;
}
