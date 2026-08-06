import "dotenv/config";
import express from "express";
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

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ message: "Unexpected server error." });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`ERP backend listening on :${port}`);
});
