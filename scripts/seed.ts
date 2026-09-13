import 'dotenv/config';
import { seed } from './db-tools.js';
import { seedDemoWorkflows } from './seed-demo-workflows.js';
if(process.env.NODE_ENV==='production'||process.env.ALLOW_DEMO_SEED!=='true')throw new Error('Fictional seeding requires ALLOW_DEMO_SEED=true and a non-production environment.');
const url=process.env.MIGRATION_DATABASE_URL;
if(!url)throw new Error('MIGRATION_DATABASE_URL is required.');
if(!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw new Error('This demo seed command only targets a local database. Use deliberate production onboarding for hosted users.');
await seed(url);await seedDemoWorkflows(url);console.log('Fictional schools, users, projects, resources, schedules and credits seeded.');
