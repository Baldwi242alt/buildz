import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Actor } from '../../../packages/db/src/database.js';
import { ApiError } from './errors.js';

export class Authenticator {
  private readonly keys;
  constructor(private readonly config: Config) {
    this.keys = createRemoteJWKSet(new URL(config.AUTH_JWKS_URL), { timeoutDuration: 5000 });
  }
  async authenticate(header: string | undefined): Promise<Actor> {
    if (!header?.startsWith('Bearer ')) throw new ApiError(401,'AUTH_REQUIRED','Sign in to continue.');
    const token = header.slice(7);
    let sub: string;
    try {
      const { payload } = await jwtVerify(token,this.keys,{
        issuer:this.config.AUTH_ISSUER,audience:this.config.AUTH_AUDIENCE,algorithms:['RS256','ES256'],
        requiredClaims:['sub','exp','iat'],clockTolerance:5,
      });
      sub = z.string().uuid().parse(payload.sub);
      if (payload.role !== 'authenticated' || payload.is_anonymous === true) throw new Error('Not a registered user');
    } catch { throw new ApiError(401,'INVALID_TOKEN','The access token is invalid or expired.'); }
    // Revalidate account and email against Auth. A signed email claim alone is not proof
    // that confirmation was required or that the user has not been disabled/deleted.
    let response: globalThis.Response;
    try {
      response = await fetch(this.config.AUTH_USERINFO_URL, { headers:{
        Authorization:`Bearer ${token}`, apikey:this.config.AUTH_PUBLISHABLE_KEY,
      },signal:AbortSignal.timeout(5000) });
    } catch { throw new ApiError(503,'AUTH_UNAVAILABLE','Authentication is temporarily unavailable.'); }
    if (response.status>=500 || response.status===429) throw new ApiError(503,'AUTH_UNAVAILABLE','Authentication is temporarily unavailable.');
    if (!response.ok) throw new ApiError(401,'INVALID_TOKEN','The session is no longer valid.');
    const user = await response.json() as { id?:string; email?:string; email_confirmed_at?:string; user_metadata?:{display_name?:unknown} };
    if (user.id !== sub || !user.email || !user.email_confirmed_at) throw new ApiError(403,'EMAIL_UNVERIFIED','Confirm your email before continuing.');
    const parsedEmail=z.email().safeParse(user.email);
    if(!parsedEmail.success)throw new ApiError(403,'EMAIL_UNVERIFIED','A confirmed email is required.');
    const email=parsedEmail.data.toLowerCase();
    const name = typeof user.user_metadata?.display_name==='string' ? user.user_metadata.display_name.trim().slice(0,100) : email.split('@')[0]!;
    return { id:sub,email,displayName:name || 'Student' };
  }
}
