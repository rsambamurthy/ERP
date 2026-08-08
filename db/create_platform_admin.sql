-- Create (or promote) a platform admin — the "superuser" who isn't a member
-- of any organization but can log in and see every org via /admin.
-- Equivalent to running:
--   npx ts-node scripts/create-admin.ts --email sambamurthyr@outlook.com --password "Admin@2026"
-- but as raw SQL, for running directly in Railway's Postgres "Data" tab.
--
-- Password hash below is bcrypt("Admin@2026", cost 10) — generated locally
-- with the same bcryptjs library the backend itself uses, never sent
-- anywhere. Change the password afterwards if you'd like a different one
-- (see the UPDATE variant at the bottom).

INSERT INTO users (email, password_hash, is_verified, is_platform_admin)
VALUES (
  'sambamurthyr@outlook.com',
  '$2a$10$4VD0FWhsjE9EH2ChA9ScDOl4NXbWCoOWD8YvZ2CDhP7YQ6Cp6wmQ6',
  true,
  true
)
ON CONFLICT (email) DO UPDATE
  SET is_platform_admin = true,
      is_verified = true,
      password_hash = EXCLUDED.password_hash;

-- Log in at /login with:
--   email:    sambamurthyr@outlook.com
--   password: Admin@2026
-- You'll land in /admin instead of a normal org dashboard.
