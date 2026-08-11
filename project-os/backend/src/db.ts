import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaClient: PrismaClient | undefined;
}

// Same singleton pattern as SmartERP's own src/db.ts — avoids exhausting
// the connection pool from ts-node-dev hot reloads in development.
export const prisma = global.prismaClient ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.prismaClient = prisma;
}
