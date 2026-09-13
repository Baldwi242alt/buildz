import 'dotenv/config';
import { migrate } from './db-tools.js';
const url=process.env.MIGRATION_DATABASE_URL;
if(!url)throw new Error('Set MIGRATION_DATABASE_URL to a migration-owner connection.');
await migrate(url,process.env.DATABASE_SSL==='true');
console.log('Database migrations applied.');
