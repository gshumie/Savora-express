import { neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@prisma/client';
import ws from 'ws';
import { config } from '../config.js';

neonConfig.webSocketConstructor = ws;

const adapter = new PrismaNeon({
  connectionString: config.databaseUrl,
});

export const prisma = new PrismaClient({
  adapter,
  log: ['warn', 'error'],
});
