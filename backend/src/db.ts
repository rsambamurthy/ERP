import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaClient: PrismaClient | undefined;
}

// TRANSACTION BUDGET. Prisma's defaults for an interactive transaction are
// maxWait 2s and timeout 5s, and nothing in this codebase overrode them. Five
// seconds sounds generous until you count round trips: a depreciation run with
// seven branches issues about twenty-nine statements inside one transaction and
// blew straight through it (P2028, "Transaction already closed"), rolling back
// and returning a generic 500. It would pass every test with one or two
// branches and fail the day a real client had seven.
//
// Set here rather than per call site so every $transaction in the codebase
// inherits it — purchase bills with many lines and branch transfers have the
// same shape and the same exposure.
export const prisma = global.prismaClient ?? new PrismaClient({
  transactionOptions: { maxWait: 10_000, timeout: 60_000 },
});

if (process.env.NODE_ENV !== "production") {
  global.prismaClient = prisma;
}
