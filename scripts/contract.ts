import SwaggerParser from '@apidevtools/swagger-parser';
import { contract, routes } from '../apps/api/src/contract.js';
import fixtures from '../packages/fixtures/identities.json' with {type:'json'};
await SwaggerParser.validate('packages/contracts/openapi.yaml');
const ids=routes.map(r=>r.operation.operationId);
if(new Set(ids).size!==ids.length)throw new Error('Duplicate operationId');
const schools=routes.find(r=>r.operation.operationId==='listInstitutions')!;
if(!schools.response({data:fixtures.institutions,meta:{requestId:'fixture-validation'}}))throw new Error('School fixtures do not match the contract.');
console.log(`OpenAPI ${contract.info.version}: ${routes.length} operations validated.`);
