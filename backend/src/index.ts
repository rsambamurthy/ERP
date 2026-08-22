import "dotenv/config";
import express from "express";
// Must load right after express, before any route file is imported: patches
// Express 4's router dispatch so a rejected promise inside an async route
// handler is forwarded to next(err) — the error middleware below — instead
// of becoming an unhandled rejection that (by default on modern Node) kills
// the whole process. This is exactly what took the server down on 2026-08-06:
// a Prisma error inside an async /auth/login handler crashed and
// Railway-restarted the container on every login attempt until the
// underlying migration gap was fixed. That gap is fixed now, but nothing
// else stopped the *next* unexpected error from doing the same thing again.
import "express-async-errors";
import cors from "cors";
import authRoutes from "./routes/auth";
import domainTypesRoutes from "./routes/domainTypes";
import onboardingRoutes from "./routes/onboarding";
import branchesRoutes from "./routes/branches";
import accountsRoutes from "./routes/accounts";
import businessPartnersRoutes from "./routes/businessPartners";
import journalRoutes from "./routes/journal";
import orgUsersRoutes from "./routes/orgUsers";
import adminRoutes from "./routes/admin";
import accessControlRoutes from "./routes/accessControl";
import itemsRoutes from "./routes/items";
import purchaseBillsRoutes from "./routes/purchaseBills";
import purchaseOrdersRoutes from "./routes/purchaseOrders";
import goodsReceiptNotesRoutes from "./routes/goodsReceiptNotes";
import salesOrdersRoutes from "./routes/salesOrders";
import deliveryNotesRoutes from "./routes/deliveryNotes";
import salesInvoicesRoutes from "./routes/salesInvoices";
import stockAdjustmentsRoutes from "./routes/stockAdjustments";
import inventoryRoutes from "./routes/inventory";
import salesReturnsRoutes from "./routes/salesReturns";
import purchaseReturnsRoutes from "./routes/purchaseReturns";
import orgRolesRoutes from "./routes/orgRoles";
import meRoutes from "./routes/me";
import gstRoutes from "./routes/gst";
import companyMasterRoutes from "./routes/companyMaster";
import currencyRatesRoutes from "./routes/currencyRates";
import recurringExpensesRoutes from "./routes/recurringExpenses";
import prepaidSchedulesRoutes from "./routes/prepaidSchedules";
import assetClassesRoutes from "./routes/assetClasses";
import depreciationPolicyRoutes from "./routes/depreciationPolicy";
import integrationConnectionsRoutes from "./routes/integrationConnections";
import integrationApiRoutes from "./routes/integrationApi";
import chatbotRoutes from "./routes/chatbot";

// Last-resort net for anything outside Express's request cycle entirely
// (a rejected promise with no .catch anywhere, a timer callback that
// throws, etc.) — express-async-errors above only covers route handlers.
// Same convention SmartAppt uses: log it, keep the process (and the
// healthcheck) alive, rather than letting Node's default behavior
// terminate on an unhandled rejection.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRoutes);
app.use("/domain-types", domainTypesRoutes);
app.use("/onboarding", onboardingRoutes);
app.use("/branches", branchesRoutes);
app.use("/accounts", accountsRoutes);
app.use("/business-partners", businessPartnersRoutes);
app.use("/journal", journalRoutes);
app.use("/org/users", orgUsersRoutes);
app.use("/admin", adminRoutes);
app.use("/access-control", accessControlRoutes);
app.use("/items", itemsRoutes);
app.use("/purchase-bills", purchaseBillsRoutes);
app.use("/purchase-orders", purchaseOrdersRoutes);
app.use("/goods-receipt-notes", goodsReceiptNotesRoutes);
app.use("/sales-orders", salesOrdersRoutes);
app.use("/delivery-notes", deliveryNotesRoutes);
app.use("/sales-invoices", salesInvoicesRoutes);
app.use("/stock-adjustments", stockAdjustmentsRoutes);
app.use("/inventory", inventoryRoutes);
app.use("/sales-returns", salesReturnsRoutes);
app.use("/purchase-returns", purchaseReturnsRoutes);
app.use("/org-roles", orgRolesRoutes);
app.use("/me", meRoutes);
app.use("/gst", gstRoutes);
app.use("/company-master", companyMasterRoutes);
app.use("/currency-rates", currencyRatesRoutes);
app.use("/recurring-expenses", recurringExpensesRoutes);
app.use("/prepaid-schedules", prepaidSchedulesRoutes);
app.use("/asset-classes", assetClassesRoutes);
app.use("/depreciation-policy", depreciationPolicyRoutes);
app.use("/chatbot", chatbotRoutes);
// Mounted at two different paths, most-specific first — both routers
// apply their auth middleware via a path-less `router.use(...)`, so if
// the broader /integration prefix were checked first, its router would
// intercept every request (including /integration/business-partners)
// before Express ever got to check the more specific one, rejecting
// service-key calls with the wrong (Bearer-token) auth error. Learned
// this the hard way — first version had both at "/integration" and the
// sync job's X-Api-Key requests were swallowed by integrationConnections'
// user-JWT `authenticate` before ever reaching integrationApi.
app.use("/integration/connections", integrationConnectionsRoutes);
app.use("/integration", integrationApiRoutes);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);

  // Body-parser and multer raise errors that are the *caller's* fault, not
  // ours. Collapsing them into a blanket 500 "Unexpected server error." is
  // what made the oversized bulk-upload failure so hard to diagnose from the
  // UI — the browser showed a server crash for what was really "your payload
  // is too big". Surface the real status and a message the user can act on.
  const e = err as { type?: string; status?: number; statusCode?: number; limit?: number; length?: number };

  if (e?.type === "entity.too.large") {
    const mb = (n?: number) => (n ? `${(n / 1024 / 1024).toFixed(1)}MB` : "unknown");
    return res.status(413).json({
      message:
        `Upload is too large (${mb(e.length)}; limit ${mb(e.limit)}). ` +
        `Split the file into smaller batches and upload them one at a time.`,
    });
  }
  if (e?.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Request body was not valid JSON." });
  }

  const status = e?.status ?? e?.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return res.status(status).json({ message: "Request could not be processed." });
  }

  res.status(500).json({ message: "Unexpected server error." });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`ERP backend listening on :${port}`);
});
