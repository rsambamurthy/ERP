-- migration_050: the chart of accounts has no equity, and a balance sheet
-- cannot be drawn without it.
--
-- coa_templates carried ASSET, LIABILITY, INCOME and EXPENSE rows and not one
-- EQUITY row, so assets minus liabilities had nowhere to land. Schedule III
-- opens with "Equity and Liabilities", and its first head is Shareholders'
-- Funds - share capital, then reserves and surplus. Neither existed.
--
-- Three accounts, all core (domain_type_id NULL) because every organisation
-- needs them whatever it sells:
--
--   3001 Share Capital        what the owners put in.
--   3002 Reserves & Surplus   what the business has kept. The P&L closes here.
--   3003 Opening Balance Equity
--                             the suspense used while LOADING a ledger that
--                             started life somewhere else. Every opening
--                             balance credits it; once they are all in, its
--                             balance is the opening net worth, and it is
--                             journalled into 3002 and left at nil. A non-zero
--                             3003 after go-live means the load is unfinished,
--                             which is exactly what you want it to say.
--
-- is_control_account is false for all three: they carry the company's own
-- money, not a ledger of balances owed to or by other parties, so there are no
-- sub-ledger cards to keep.

INSERT INTO coa_templates (domain_type_id, account_code, account_name, account_type, is_control_account, default_bp_type)
SELECT NULL, v.code, v.name, 'EQUITY', false, NULL
FROM (VALUES
  ('3001', 'Share Capital'),
  ('3002', 'Reserves & Surplus'),
  ('3003', 'Opening Balance Equity')
) AS v(code, name)
WHERE NOT EXISTS (
  SELECT 1 FROM coa_templates t
  WHERE t.account_code = v.code AND t.domain_type_id IS NULL
);

-- Organisations provisioned BEFORE this migration copied the chart as it stood
-- and will not have these accounts. Provisioning is idempotent, so re-running
-- it fills them in - but it is not run automatically here, because it touches
-- every organisation in the database and that should be a decision, not a
-- side effect of a migration. See lib/provisioning.ts.
--
-- To find the organisations that need it:
--   SELECT o.id, o.business_name
--   FROM organizations o
--   WHERE NOT EXISTS (
--     SELECT 1 FROM accounts a
--     WHERE a.organization_id = o.id AND a.account_code = '3003');

-- Verify:
--   SELECT account_code, account_name FROM coa_templates
--   WHERE account_type = 'EQUITY' ORDER BY account_code;
