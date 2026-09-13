import { expect, it } from 'vitest';
import { loadConfig } from '../apps/api/src/config.js';

const environment = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://buildz_api:placeholder@db.example/postgres',
  DATABASE_SSL: 'true',
  AUTH_ISSUER: 'https://auth.example/auth/v1',
  AUTH_JWKS_URL: 'https://auth.example/auth/v1/.well-known/jwks.json',
  AUTH_USERINFO_URL: 'https://auth.example/auth/v1/user',
  AUTH_PUBLISHABLE_KEY: 'public-placeholder',
  CORS_ORIGINS: 'https://buildz.example',
  APP_ORIGIN: 'https://buildz.example',
};

it('does not trust forwarded client addresses unless the operator configures hops', () => {
  expect(loadConfig(environment).TRUST_PROXY_HOPS).toBe(0);
  expect(loadConfig({ ...environment, TRUST_PROXY_HOPS: '2' }).TRUST_PROXY_HOPS).toBe(2);
  for (const value of ['true', '-1', '1.5', '11']) {
    expect(() => loadConfig({ ...environment, TRUST_PROXY_HOPS: value })).toThrow('TRUST_PROXY_HOPS');
  }
});

it('rejects hosted loopback URLs and unverified database TLS', () => {
  expect(() => loadConfig({ ...environment, APP_ORIGIN: 'http://localhost:5173' })).toThrow('HTTPS');
  expect(() => loadConfig({ ...environment, DATABASE_SSL: 'false' })).toThrow('TLS');
  expect(() => loadConfig({ ...environment, CORS_ORIGINS: 'https://buildz.example/' })).toThrow('exact origins');
});
