import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { Ajv, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { ApiError } from './errors.js';
type Schema=Record<string,unknown>;
type Parameter={name:string;in:string;required?:boolean;schema:Schema};
export type Operation={operationId:string;security?:unknown[];parameters?:Parameter[];requestBody?:{required?:boolean;content:Record<string,{schema:Schema}>};responses:Record<string,{content?:Record<string,{schema:Schema}>}>;'x-idempotent'?:boolean;'x-paginated'?:boolean};
type Route={method:string;path:string;regex:RegExp;names:string[];operation:Operation;body?:ValidateFunction;query:ValidateFunction;params:ValidateFunction;response:ValidateFunction;status:number};
export const contract=parse(readFileSync(resolve('packages/contracts/openapi.yaml'),'utf8')) as {
  openapi:string;info:{version:string};components:{schemas:Record<string,Schema>};paths:Record<string,Record<string,Operation>>;
};
function refs(value:unknown):unknown {
  if(Array.isArray(value))return value.map(refs);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,k==='$ref'&&typeof v==='string'&&v.startsWith('#/')?'buildz'+v:refs(v)]));
  return value;
}
const ajv=new Ajv({allErrors:true,strict:false,coerceTypes:false});
const queryAjv=new Ajv({allErrors:true,strict:false,coerceTypes:true});
for(const a of [ajv,queryAjv]) {
  addFormats.default(a);
  a.addFormat('iana-timezone',{type:'string',validate:(v:string)=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}}});
  a.addSchema(refs({components:contract.components}) as Schema,'buildz');
}
function objectSchema(parameters:Parameter[]) {return {type:'object',additionalProperties:false,
  properties:Object.fromEntries(parameters.map(p=>[p.name,refs(p.schema)])),required:parameters.filter(p=>p.required).map(p=>p.name)};}
export const routes:Route[]=Object.entries(contract.paths).flatMap(([path,methods])=>Object.entries(methods).map(([method,operation])=>{
  const names=[...path.matchAll(/\{(\w+)\}/g)].map(m=>m[1]!);
  const params=operation.parameters??[];
  const status=Number(Object.keys(operation.responses).find(s=>s.startsWith('2'))!);
  const response=operation.responses[String(status)]!.content!['application/json']!.schema;
  const body=operation.requestBody?.content['application/json']?.schema;
  return {method:method.toUpperCase(),path,regex:new RegExp('^'+path.replace(/\{\w+\}/g,'([^/]+)')+'/?$'),names,operation,status,
    body:body?ajv.compile(refs(body) as Schema):undefined,
    query:queryAjv.compile(objectSchema(params.filter(p=>p.in==='query'))),
    params:ajv.compile(objectSchema(params.filter(p=>p.in==='path'))),response:ajv.compile(refs(response) as Schema)};
}));
export function validate(validator:ValidateFunction|undefined,value:unknown) {
  if(validator&&!validator(value)) throw new ApiError(422,'VALIDATION_FAILED',
    validator.errors?.map(e=>`${e.instancePath||'/'} ${e.message}`).slice(0,5).join('; ')??'Invalid input.');
}
