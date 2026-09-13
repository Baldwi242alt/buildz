/** Mechanical, repeatable schema expansion; runtime never imports this file. */
import {readFileSync,writeFileSync} from 'node:fs';
import {parse,stringify} from 'yaml';
const file='packages/contracts/openapi.yaml';
const doc=parse(readFileSync(file,'utf8'),{maxAliasCount:-1});
type Schema=Record<string,any>;
const uuid={type:'string',format:'uuid'},date={type:'string',format:'date-time'};
const text=(max:number)=>({type:'string',minLength:1,maxLength:max,pattern:'.*\\S.*'});
const obj=(properties:Schema)=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const ref=(name:string)=>({$ref:'#/components/schemas/'+name});
const arr=(items:Schema)=>({type:'array',items});
Object.assign(doc.components.schemas,{
 CalendarSpan:obj({startsAt:date,endsAt:date}),
 ResourceCalendar:obj({windows:arr(ref('CalendarSpan')),busy:arr(ref('CalendarSpan'))}),
 TeamCalendar:obj({members:arr(obj({userId:uuid,displayName:text(100),windows:arr(ref('CalendarSpan')),busy:arr(ref('CalendarSpan'))}))}),
 Mentor:obj({userId:uuid,displayName:text(100),institutionId:uuid}),
 Mentorship:obj({id:uuid,projectId:uuid,mentorId:uuid,requestedBy:uuid,message:text(2000),state:{type:'string',enum:['pending','accepted','declined','cancelled']},version:{type:'integer',minimum:1},createdAt:date,mentorDisplayName:text(100),projectTitle:text(150)}),
 RequestMentorship:obj({mentorId:uuid,message:text(2000)}),
 DecideMentorship:obj({version:{type:'integer',minimum:1},decision:{type:'string',enum:['accepted','declined','cancelled']}})
});
function route(path:string,method:string,operationId:string,result:Schema,body?:string,query:Schema[]=[]){
 const parameters:Schema[]=[...(path.includes('{id}')?[{name:'id',in:'path',required:true,schema:uuid}]:[]),...query];
 if(method==='post')parameters.push({name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',minLength:8,maxLength:128}});
 const op:Schema={operationId,summary:operationId,parameters,responses:{[method==='post'&&operationId==='requestMentorship'?'201':'200']:{description:'Success',content:{'application/json':{schema:obj({data:result,meta:ref('Meta')})}}},default:{description:'Structured error',content:{'application/json':{schema:ref('Error')}}}}};
 if(body)op.requestBody={required:true,content:{'application/json':{schema:ref(body)}}};
 if(method==='post')op['x-idempotent']=true;
 doc.paths[path]??={};doc.paths[path][method]=op;
}
const span=['startsAt','endsAt'].map(name=>({name,in:'query',required:true,schema:date}));
route('/v1/projects/{id}/team-calendar','get','getTeamCalendar',ref('TeamCalendar'),undefined,span);
route('/v1/resources/{id}/calendar','get','getResourceCalendar',ref('ResourceCalendar'),undefined,span);
route('/v1/mentors','get','listMentors',arr(ref('Mentor')),undefined,[{name:'institutionId',in:'query',required:false,schema:uuid}]);
route('/v1/projects/{id}/mentorships','get','listProjectMentorships',arr(ref('Mentorship')));
route('/v1/projects/{id}/mentorships','post','requestMentorship',ref('Mentorship'),'RequestMentorship');
route('/v1/mentorships','get','listMentorships',arr(ref('Mentorship')));
route('/v1/mentorships/{id}/decisions','post','decideMentorship',ref('Mentorship'),'DecideMentorship');
doc.info.version='0.3.0';
writeFileSync(file,stringify(doc,{lineWidth:110}));
