// One-off script to create (or promote) a platform admin — the "superuser"
// who isn't a member of any organization but can see every org, toggle
// subscriptions, and read the audit trail. There's deliberately no signup
// UI for this; run it yourself against whichever DATABASE_URL you're
// pointed at:
//
//   npx ts-node scripts/create-admin.ts --email you@example.com --password "something long"
//
// Safe to re-run — if the user already exists it just flips
// is_platform_admin to true (and updates the password if you pass one).
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email");
  const phone = arg("phone");
  const password = arg("password");

  if ((!email && !phone) || !password) {
    console.error("Usage: ts-node scripts/create-admin.ts --email you@example.com --password 'something long'");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password!, 10);

  const existing = await prisma.user.findFirst({
    where: { OR: [email ? { email } : undefined, phone ? { phone } : undefined].filter(Boolean) as any },
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { isPlatformAdmin: true, isVerified: true, passwordHash },
    });
    console.log(`Updated existing user ${existing.id} — now a platform admin.`);
  } else {
    const user = await prisma.user.create({
      data: { email, phone, passwordHash, isVerified: true, isPlatformAdmin: true },
    });
    console.log(`Created platform admin user ${user.id}.`);
  }

  console.log("Log in at /login with these credentials — you'll land in /admin.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
