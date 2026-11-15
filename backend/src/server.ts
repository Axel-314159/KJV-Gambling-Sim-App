import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { env } from './config/env.js';
import { registerAuthHooks } from './plugins/auth.js';
import { authRoutes } from './modules/auth/routes.js';
import { roundRoutes } from './modules/rounds/routes.js';
import { kjvRoutes } from './modules/kjv/routes.js';
import { statsRoutes } from './modules/stats/routes.js';
import { adminRoutes } from './modules/admin/routes.js';
import { startScheduler } from './jobs/scheduler.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: env.APP_BASE_URL, credentials: true });
await app.register(cookie, { secret: env.COOKIE_SECRET });

await registerAuthHooks(app);
await app.register(authRoutes);
await app.register(roundRoutes);
await app.register(kjvRoutes);
await app.register(statsRoutes);
await app.register(adminRoutes);

const boss = await startScheduler();

const shutdown = async () => {
  await boss.stop();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: env.PORT, host: '0.0.0.0' });