import { readFile } from 'node:fs/promises';
import openapiTS, { astToString } from 'openapi-typescript';
const generated=astToString(await openapiTS(new URL('../packages/contracts/openapi.yaml',import.meta.url)));
const current=await readFile('packages/sdk/src/schema.d.ts','utf8');
const normalize=(s:string)=>s.replace(/^\/\*\*\s*\n \* This file was auto-generated[\s\S]*?\*\/\s*/,'').trim().replace(/\r\n/g,'\n');
if(normalize(generated)!==normalize(current))throw new Error('SDK is stale. Run npm run sdk:generate and include the change.');
console.log('Generated SDK matches the contract.');
