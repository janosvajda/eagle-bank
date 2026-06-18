import { PrismaClient } from '../../generated/prisma/client.js';

// One Prisma client per Node process. Repositories receive this shared instance
// from service startup so request handlers never create their own DB pools.
export const prisma = new PrismaClient();
