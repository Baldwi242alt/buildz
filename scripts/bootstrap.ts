import 'dotenv/config';
import pg from 'pg';
import { parseArgs } from 'node:util';
import { z } from 'zod';
const {values}=parseArgs({options:{'user-id':{type:'string'},email:{type:'string'},name:{type:'string'},'institution-id':{type:'string'},
  'institution-name':{type:'string'},'institution-slug':{type:'string'},role:{type:'string'},'api-password':{type:'boolean'},'worker-password':{type:'boolean'}}});
const url=process.env.MIGRATION_DATABASE_URL;if(!url)throw new Error('MIGRATION_DATABASE_URL is required.');
const client=new pg.Client({connectionString:url,ssl:process.env.DATABASE_SSL==='true'?{rejectUnauthorized:true}:false});await client.connect();
try {
  await client.query('BEGIN');
  if(values['api-password']||values['worker-password']){
    const name=values['api-password']?'buildz_api':'buildz_worker';
    const password=process.env.RUNTIME_ROLE_PASSWORD;
    if(!password||password.length<24)throw new Error('Set RUNTIME_ROLE_PASSWORD to a new secret of at least 24 characters.');
    await client.query(`ALTER ROLE ${name} LOGIN PASSWORD ${pg.escapeLiteral(password)}`);
  }else{
    const person=z.object({id:z.uuid(),email:z.email(),name:z.string().min(1).max(100),school:z.uuid(),role:z.enum(['student','institution_admin'])}).parse({
      id:values['user-id'],email:values.email,name:values.name,school:values['institution-id'],role:values.role});
    if(values['institution-name']){
      const slug=z.string().regex(/^[a-z0-9-]{2,80}$/).parse(values['institution-slug']);
      await client.query('insert into app.institutions(id,name,slug) values($1,$2,$3) on conflict(id) do nothing',[person.school,values['institution-name'],slug]);
    }
    await client.query('insert into app.profiles(id,email,display_name) values($1,$2,$3) on conflict(id) do nothing',[person.id,person.email.toLowerCase(),person.name]);
    await client.query(`insert into app.institution_memberships(institution_id,user_id,affiliation,status)
      values($1,$2,$3,'verified') on conflict(institution_id,user_id,affiliation) do update set status='verified'`,[person.school,person.id,person.role==='student'?'student':'staff']);
    if(person.role==='institution_admin')await client.query(`insert into app.role_assignments(institution_id,user_id,role)
      values($1,$2,'institution_admin') on conflict(institution_id,user_id,role) where revoked_at is null do nothing`,[person.school,person.id]);
    await client.query("insert into app.audit_events(actor_id,action,subject_id) values(null,'operator.bootstrap',$1)",[person.id]);
  }
  await client.query('COMMIT');console.log('Requested bootstrap operation completed.');
}catch(error){await client.query('ROLLBACK');throw error;}finally{await client.end();}
