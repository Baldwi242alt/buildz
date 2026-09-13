import 'reflect-metadata';
import { All, Controller, Inject, Module, Req, Res, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { database, assertRuntimeRole, asActor, type Db } from '../../../packages/db/src/database.js';
import { loadConfig, type Config } from './config.js';
import { Authenticator } from './auth.js';
import { ErrorFilter, ApiError } from './errors.js';
import { routes, validate, contract } from './contract.js';
import { type Context, type Handler, idempotent } from './context.js';
import { ensureProfile, me, updateMe } from './identity.js';
import * as schools from './institutions.js';
import * as projects from './projects.js';
import * as invitations from './invitations.js';
import * as proposals from './proposals.js';
import * as resources from './resources.js';
import * as bookings from './bookings.js';
import * as communication from './communication.js';
import * as community from './community.js';
import * as credits from './credits.js';
import * as files from './files.js';
const handlers:Record<string,Handler>={getMe:me,updateMe,
  listInstitutions:schools.listInstitutions,getInstitution:schools.getInstitution,requestVerification:schools.requestVerification,
  listVerifications:schools.listVerifications,decideVerification:schools.decideVerification,
  listProjects:projects.listProjects,createProject:projects.createProject,getProject:projects.getProject,updateProject:projects.updateProject,
  transitionProject:projects.transitionProject,listMembers:projects.listMembers,removeMember:projects.removeMember,transferOwner:projects.transferOwner,
  invite:invitations.invite,getInvitation:invitations.getInvitation,listInvitations:invitations.listInvitations,
  acceptInvitation:invitations.acceptInvitation,declineInvitation:c=>invitations.decideInvitation(c,'declined'),revokeInvitation:c=>invitations.decideInvitation(c,'revoked'),
  ...proposals,...resources,...bookings,...communication,...community,...credits,...files,reviewProjects:projects.reviewProjects};
class Runtime {
  readonly auth:Authenticator;
  constructor(readonly config:Config,readonly db:Db) {this.auth=new Authenticator(config);}
}
@Controller()
class ApiController {
  constructor(@Inject(Runtime) private readonly runtime:Runtime) {}
  @All('{*path}')
  async handle(@Req() req:Request,@Res() res:Response) {
    const route=routes.find(r=>r.method===req.method&&r.regex.test(req.path));
    if(!route)throw new ApiError(404,'NOT_FOUND','Route not found.');
    const match=route.regex.exec(req.path)!;
    let params:Record<string,string>;
    try{params=Object.fromEntries(route.names.map((n,i)=>[n,decodeURIComponent(match[i+1]!)]));}
    catch{throw new ApiError(400,'INVALID_PATH','The request path is malformed.');}
    const query={...req.query};validate(route.params,params);validate(route.query,query);
    if(route.body)validate(route.body,req.body);
    else if(req.body&&Object.keys(req.body as object).length)throw new ApiError(422,'VALIDATION_FAILED','This operation does not accept a request body.');
    let data:unknown;
    const envelope=(value:unknown)=>{
      const paged=value as {items:unknown[];nextCursor:string|null};
      return JSON.parse(JSON.stringify(route.operation['x-paginated']?
        {data:paged.items,meta:{requestId:res.locals.requestId,nextCursor:paged.nextCursor}}:
        {data:value,meta:{requestId:res.locals.requestId}})) as unknown;
    };
    if(route.operation.security?.length===0) {
      if(route.operation.operationId==='readiness')await sql`select 1`.execute(this.runtime.db);
      if(handlers[route.operation.operationId]){
        const actor={id:'00000000-0000-4000-8000-000000000000',email:'',displayName:'Anonymous'};
        data=await asActor(this.runtime.db,actor,tx=>handlers[route.operation.operationId]!({actor,tx,params,query,body:{},config:this.runtime.config}));
      }else data=route.operation.operationId==='getMeta'?{apiVersion:contract.info.version,milestones:['M0','M1','M2','M3','M4','M5','M6'],
        features:{projects:true,invitations:true,publicProjects:true,bookings:true,liveEvents:false,proposals:true,progress:true,resources:true,availability:true,consultations:true,messages:true,notifications:true,vouchers:true,files:true},auth:{issuer:this.runtime.config.AUTH_ISSUER,audience:this.runtime.config.AUTH_AUDIENCE}}
        :{status:'ok'};
    } else {
      const actor=await this.runtime.auth.authenticate(req.header('Authorization'));
      data=await asActor(this.runtime.db,actor,async tx=>{
        const ctx:Context={actor,tx,params,query,body:req.body??{},config:this.runtime.config};
        await ensureProfile(ctx);
        const handler=handlers[route.operation.operationId];
        if(!handler)throw new Error('Contract operation lacks handler');
        const value=await (route.operation['x-idempotent']?idempotent(ctx,route.operation.operationId,req.header('Idempotency-Key')??'',handler):handler(ctx));
        if(!route.response(envelope(value)))throw new Error('Response does not match the API contract');
        return value;
      });
    }
    const payload=envelope(data);
    if(!route.response(payload))throw new Error('Response does not match the API contract');
    res.status(route.status).json(payload);
  }
}
@Module({controllers:[ApiController]})
class ApiModule {}

export async function createApp(config=loadConfig()):Promise<{app:INestApplication;db:Db;close:()=>Promise<void>}> {
  for(const r of routes)if(!handlers[r.operation.operationId]&&!['getMeta','liveness','readiness'].includes(r.operation.operationId))throw new Error(`Missing handler: ${r.operation.operationId}`);
  const db=database(config.DATABASE_URL,config.DATABASE_SSL==='true');
  try {await assertRuntimeRole(db);}catch(error){await db.destroy();throw error;}
  const runtime=new Runtime(config,db);
  const app=await NestFactory.create<NestExpressApplication>({module:ApiModule,providers:[{provide:Runtime,useValue:runtime}]},{logger:false,bodyParser:true});
  // Keep direct/local requests untrusted. The operator must verify the exact hosted
  // proxy path before enabling a hop count; trusting every forwarded header is unsafe.
  app.set('trust proxy',config.TRUST_PROXY_HOPS);
  app.use(helmet());
  app.use((req:Request,res:Response,next:()=>void)=>{res.locals.requestId=randomUUID();res.setHeader('X-Request-Id',res.locals.requestId);res.setHeader('Cache-Control','no-store');next();});
  const origins=config.CORS_ORIGINS.split(',');
  app.enableCors({origin:(origin:string|undefined,callback:(error:Error|null,allow:boolean)=>void)=>callback(null,!origin||origins.includes(origin)),methods:['GET','POST','PATCH','DELETE','OPTIONS'],
    allowedHeaders:['Content-Type','Authorization','Idempotency-Key'],exposedHeaders:['X-Request-Id','Retry-After'],maxAge:600});
  // Bounded, per-IP rate limiting for the initial single-instance deployment.
  // Reverse-proxy trust must be configured deliberately before horizontal scaling.
  const limits=new Map<string,{count:number;until:number}>();
  app.use((req:Request,res:Response,next:()=>void)=>{
    if(req.path.startsWith('/v1/health/'))return next();
    const now=Date.now();const key=req.ip??'unknown';let limit=limits.get(key);
    if(!limit||limit.until<now){
      if(limits.size>=10000)for(const [k,v] of limits)if(v.until<now)limits.delete(k);
      if(limits.size>=10000&&!limits.has(key)){
        res.status(429).json({error:{code:'RATE_LIMITED',message:'Try again shortly.',retryable:true,requestId:res.locals.requestId}});return;
      }
      limit={count:0,until:now+60000};limits.set(key,limit);
    }
    if(++limit.count>300){res.status(429).setHeader('Retry-After','60');res.json({error:{code:'RATE_LIMITED',message:'Too many requests.',retryable:true,requestId:res.locals.requestId}});return;}
    if(limits.size>10000)for(const [k,v] of limits)if(v.until<now)limits.delete(k);
    next();
  });
  app.useGlobalFilters(new ErrorFilter());
  // 2 MiB private files are base64-encoded in JSON; the parser stays bounded.
  app.useBodyParser('json',{limit:'3mb'});
  await app.init();
  return {app,db,close:async()=>{await app.close();await db.destroy();}};
}
