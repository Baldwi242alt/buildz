/** Detect our healthy local demo service without restarting it or rotating credentials. */
export async function runningBackend(port:number):Promise<{url:string;issuer:string}|null> {
  const url=`http://127.0.0.1:${port}`;
  try {
    const [meta,health]=await Promise.all([
      fetch(url+'/v1/meta',{signal:AbortSignal.timeout(1500)}),
      fetch(url+'/v1/health/ready',{signal:AbortSignal.timeout(1500)}),
    ]);
    if(!meta.ok||!health.ok)return null;
    const m=await meta.json() as {data?:{apiVersion?:string;milestones?:string[];auth?:{issuer?:string}}};
    const h=await health.json() as {data?:{status?:string}};
    const issuer=m.data?.auth?.issuer;
    if(h.data?.status!=='ok'||!m.data?.apiVersion||!m.data.milestones?.includes('M0')||!issuer)return null;
    const parsed=new URL(issuer);
    if(parsed.protocol!=='http:'||!['127.0.0.1','localhost'].includes(parsed.hostname))return null;
    return {url,issuer};
  }catch{return null;}
}
