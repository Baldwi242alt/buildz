import { createServer, type Server } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { fixtures, freePort } from './db-tools.js';

/** Test/development issuer only. Bound to loopback; never imported by production API. */
export async function localAuth() {
  const {publicKey,privateKey}=await generateKeyPair('RS256');const jwk=await exportJWK(publicKey);
  const port=await freePort();const issuer=`http://127.0.0.1:${port}`;
  const unconfirmed=new Set<string>();
  const token=async(index:number,extra:JWTPayload={})=>{
    const u=fixtures.users[index];if(!u)throw new Error('Unknown fixture');
    return new SignJWT({email:u.email,role:'authenticated',iss:issuer,aud:'authenticated',sub:u.id,
      iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,...extra})
      .setProtectedHeader({alg:'RS256',kid:'local-dev'}).sign(privateKey);
  };
  const server:Server=createServer((req,res)=>{void(async()=>{
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    if(req.url==='/.well-known/jwks.json'){res.end(JSON.stringify({keys:[{...jwk,kid:'local-dev',alg:'RS256',use:'sig'}]}));return;}
    if(req.url==='/token'&&req.method==='POST'){
      let body='';for await(const chunk of req){body+=String(chunk);if(body.length>1024){res.writeHead(413).end();return;}}
      const index=Number((JSON.parse(body) as {userIndex:unknown}).userIndex);
      if(!Number.isInteger(index)||!fixtures.users[index]){res.writeHead(400).end();return;}
      res.end(JSON.stringify({access_token:await token(index),token_type:'bearer',expires_in:3600}));return;
    }
    if(req.url==='/user'){
      const raw=req.headers.authorization?.slice(7)??'';
      const {payload}=await jwtVerify(raw,publicKey,{issuer,audience:'authenticated'});
      const u=fixtures.users.find(u=>u.id===payload.sub);if(!u){res.writeHead(401).end();return;}
      res.end(JSON.stringify({id:u.id,email:u.email,email_confirmed_at:unconfirmed.has(u.id)?null:'2026-01-01T00:00:00Z',user_metadata:{display_name:u.displayName}}));return;
    }
    res.writeHead(404).end();
  })().catch(()=>{res.writeHead(401).end();});});
  await new Promise<void>(ok=>server.listen(port,'127.0.0.1',ok));
  return {issuer,token,setConfirmed:(index:number,confirmed:boolean)=>{const id=fixtures.users[index]!.id;if(confirmed)unconfirmed.delete(id);else unconfirmed.add(id);},
    stop:()=>new Promise<void>((ok,fail)=>server.close(e=>e?fail(e):ok()))};
}
