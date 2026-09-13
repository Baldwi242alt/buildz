import 'dotenv/config';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
const config=loadConfig();
const runtime=await createApp(config);
await runtime.app.listen(config.PORT,'0.0.0.0');
console.log(`BuildZ API listening on port ${config.PORT}`);
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>void runtime.close().then(()=>process.exit(0)));
