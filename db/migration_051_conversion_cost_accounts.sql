-- migration_051: a production order has nowhere correct to absorb labour from.
--
-- productionOrders.ts says, in its own header, that AS 2 requires cost of
-- conversion - direct labour plus a systematic allocation of production
-- overheads - to sit in inventory, and that is why a COST posting exists at
-- all. The posting insists on a plain EXPENSE account:
--
--   if (a.accountType !== "EXPENSE") ... "Conversion cost is absorbed out of
--   an expense head."
--
-- The chart of accounts has four expense heads in total:
--
--   4003  Abnormal Production Loss      the write-off when an order is
--                                       abandoned. Cannot be absorbed - that
--                                       is the whole point of it.
--   4008  Administrative                administrative overhead.
--   4020  Depreciation & Amortisation
--   4021  Loss on Disposal of Assets
--
-- So every production order in SmartERP today has to take its labour out of
-- 4008 Administrative, and that is the one head AS 2 names as excluded:
-- administrative overheads that do not contribute to bringing the inventories
-- to their present location and condition are not part of cost. The route is
-- right and the chart cannot feed it.
--
-- TWO ACCOUNTS
--
--   4004  Direct Labour            wages of the people who made the thing.
--   4005  Production Overheads     factory rent, power, supervision, plant
--                                  depreciation - the systematic allocation
--                                  AS 2 asks for. The rate is not modelled;
--                                  the accountant enters the figure, which is
--                                  the same decision the COST posting already
--                                  takes rather than trusting a rate table
--                                  nobody maintains.
--
-- Both are expense heads, so no Schedule III balance-sheet classification -
-- they are credited as their cost is capitalised, exactly as 4008 would be.
--
-- WHICH ORGANISATIONS GET THEM
--
-- The ones that already have 1302 Work in Progress: the manufacturing
-- overlay, and the same population that can run a production order at all.
-- Every insert derives its domain and its organisations from wherever 1302
-- already lives rather than naming a domain code this file does not know.
-- This is migration_041's pattern, followed deliberately - 041 added 1304,
-- 1305 and 4003 the same way, and these accounts belong to the same overlay.
--
-- Unlike migration_050, this DOES back-fill existing organisations. 050 left
-- that as a decision because equity touches every organisation in the
-- database; this touches only manufacturers, and an organisation that has
-- 1302 and cannot post a conversion cost is broken today.
--
-- Statements stand alone - run them one at a time.
-- Idempotent: safe to re-run. Each insert skips what is already there.


-- 1. Template: 4004, so newly provisioned organisations get it too.
INSERT INTO coa_templates (domain_type_id, account_code, account_name, account_type, is_control_account, schedule_iii_head)
SELECT t.domain_type_id, '4004', 'Direct Labour', 'EXPENSE', false, NULL
  FROM coa_templates t
 WHERE t.account_code = '1302'
   AND NOT EXISTS (
         SELECT 1 FROM coa_templates x
          WHERE x.domain_type_id IS NOT DISTINCT FROM t.domain_type_id
            AND x.account_code = '4004');


-- 2. Template: 4005.
INSERT INTO coa_templates (domain_type_id, account_code, account_name, account_type, is_control_account, schedule_iii_head)
SELECT t.domain_type_id, '4005', 'Production Overheads', 'EXPENSE', false, NULL
  FROM coa_templates t
 WHERE t.account_code = '1302'
   AND NOT EXISTS (
         SELECT 1 FROM coa_templates x
          WHERE x.domain_type_id IS NOT DISTINCT FROM t.domain_type_id
            AND x.account_code = '4005');


-- 3. Every organisation that already has 1302: 4004.
INSERT INTO accounts (organization_id, account_code, account_name, account_type, is_control_account, schedule_iii_head, is_system)
SELECT a.organization_id, '4004', 'Direct Labour', 'EXPENSE', false, NULL, true
  FROM accounts a
 WHERE a.account_code = '1302'
   AND NOT EXISTS (
         SELECT 1 FROM accounts x
          WHERE x.organization_id = a.organization_id
            AND x.account_code = '4004');


-- 4. And 4005.
INSERT INTO accounts (organization_id, account_code, account_name, account_type, is_control_account, schedule_iii_head, is_system)
SELECT a.organization_id, '4005', 'Production Overheads', 'EXPENSE', false, NULL, true
  FROM accounts a
 WHERE a.account_code = '1302'
   AND NOT EXISTS (
         SELECT 1 FROM accounts x
          WHERE x.organization_id = a.organization_id
            AND x.account_code = '4005');


-- Verify:
--   SELECT account_code, account_name, account_type FROM coa_templates
--   WHERE account_code IN ('4003','4004','4005','4008') ORDER BY account_code;
--
--   SELECT count(*) AS orgs_with_1302,
--          count(*) FILTER (WHERE has_4004) AS orgs_with_4004
--   FROM (SELECT a.organization_id,
--                EXISTS (SELECT 1 FROM accounts x
--                         WHERE x.organization_id = a.organization_id
--                           AND x.account_code = '4004') AS has_4004
--           FROM accounts a WHERE a.account_code = '1302') s;
--   -- the two counts must match.
