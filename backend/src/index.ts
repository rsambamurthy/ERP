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
import salesInvoicesRoutes from "./routes/salesInvoices";
import stockAdjustmentsRoutes from "./routes/stockAdjustments";
import inventoryRoutes from "./routes/inventory";
import salesReturnsRoutes from "./routes/salesReturns";
import purchaseReturnsRoutes from "./routes/purchaseReturns";
import orgRolesRoutes from "./routes/orgRoles";
import meRoutes from "./routes/me";
import gstRoutes from "./routes/gst";

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
app.use(express.json());

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
app.use("/sales-invoices", salesInvoicesRoutes);
app.use("/stock-adjustments", stockAdjustmentsRoutes);
app.use("/inventory", inventoryRoutes);
app.use("/sales-returns", salesReturnsRoutes);
app.use("/purchase-returns", purchaseReturnsRoutes);
app.use("/org-roles", orgRolesRoutes);
app.use("/me", meRoutes);
app.use("/gst", gstRoutes);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ message: "Unexpected server error." });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`ERP backend listening on :${port}`);
});
