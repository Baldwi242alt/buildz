import { createServer } from 'node:http';
import { expect,it } from 'vitest';
import { runningBackend } from '../scripts/dev-status.js';

it('recognises a healthy local backend and rejects an unrelated or unhealthy service',async()=>{
  let healthy=true;
  const server=createServer((req,res)=>{
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(req.url==='/v1/meta'?{data:{apiVersion:'0.1.0',milestones:['M0','M1'],auth:{issuer:'http://127.0.0.1:5555'}}}:{data:{status:healthy?'ok':'failed'}}));
  });
  await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok));
  const address=server.address();if(!address||typeof address==='string')throw new Error('No address');
  try{
    expect(await runningBackend(address.port)).toEqual({url:`http://127.0.0.1:${address.port}`,issuer:'http://127.0.0.1:5555'});
    healthy=false;expect(await runningBackend(address.port)).toBeNull();
  }finally{await new Promise<void>(ok=>server.close(()=>ok()));}
  expect(await runningBackend(address.port)).toBeNull();
});
