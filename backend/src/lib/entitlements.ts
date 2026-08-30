import { prisma } from "../db";

// WHICH MODULES AN ORGANISATION HAS HAD WITHDRAWN.
//
// `org_modules` has existed since provisioning was written, and until now
// nothing read it outside the platform admin console. Cancelling a
// subscription set a row to CANCELLED and changed nothing else: the menu
// still offered the screens and the API still served them. This module is
// the missing half - one place that answers "may this organisation use
// INVENTORY", used by the sidebar to decide what to offer and by
// requireModule() to decide what to serve.
//
// ABSENCE IS NOT DENIAL, and that is the whole design.
//
// A row that says CANCELLED, or one whose expires_on has passed, is a
// decision somebody made, and it denies. NO ROW AT ALL is not a decision -
// it is an organisation that predates the provisioning code that writes
// these rows, and reading that as "unsubscribed" would lock a working
// tenant out of screens it has used for months. The admin console's
// UNSUBSCRIBED filter does read no-rows that way, which is right for a
// sales dashboard and wrong for an access check.
//
// SO THE ANSWER IS PHRASED AS A DENY LIST, not an allow list, and that is
// deliberate rather than stylistic. An allow list of active grants would
// come back EMPTY for an unprovisioned organisation, and a sidebar
// filtering on it would hide every gated group - the exact lockout this
// rule exists to prevent, reintroduced by the shape of the data. A deny
// list cannot fail that way: nothing withdrawn means nothing hidden.
//
// Once every organisation is known to be provisioned this can be tightened
// to deny-by-default. That will be a deliberate migration with a list of
// affected tenants attached, not a silent consequence of this change.

export type ModuleCode = "ACCOUNTING" | "SALES" | "PURCHASE" | "INVENTORY" | "BOM";

// True when the organisation may use the module: an ACTIVE unexpired grant,
// or no grant recorded at all. False only where a grant exists and has been
// withdrawn or has lapsed.
export async function holdsModule(organizationId: string, code: ModuleCode): Promise<boolean> {
  const row = await prisma.orgModule.findFirst({
    where: { organizationId, module: { code } },
    select: { status: true, expiresOn: true },
  });
  if (!row) return true;
  if (row.status !== "ACTIVE") return false;
  if (row.expiresOn && row.expiresOn < new Date()) return false;
  return true;
}

// The codes this organisation may NOT use, for the login response. The
// sidebar hides a nav group when its module appears here and shows it
// otherwise, so an organisation with no rows gets [] and sees everything -
// which is the same answer holdsModule() gives, reached the same way.
//
// One query rather than five holdsModule() calls: this runs on every login.
export async function deniedModuleCodes(organizationId: string): Promise<string[]> {
  const now = new Date();
  const rows = await prisma.orgModule.findMany({
    where: { organizationId },
    select: { status: true, expiresOn: true, module: { select: { code: true } } },
  });
  return rows
    .filter((r) => r.status !== "ACTIVE" || (r.expiresOn !== null && r.expiresOn < now))
    .map((r) => r.module.code)
    .sort();
}
