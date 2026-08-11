import "dotenv/config";
import express from "express";
// Same rationale as SmartERP's own index.ts: patches Express 4's router
// dispatch so a rejected promise inside an async route handler reaches
// the error middleware below instead of crashing the process.
import "express-async-errors";
import cors from "cors";

import authRoutes from "./routes/auth";
import projectsRoutes from "./routes/projects";
import boqRoutes from "./routes/boq";
import budgetRoutes from "./routes/budget";
import costCategoriesRoutes from "./routes/costCategories";
import procurementRoutes from "./routes/procurement";
import inventoryRoutes from "./routes/inventory";
import executionRoutes from "./routes/execution";
import costVisibilityRoutes from "./routes/costVisibility";
import integrationRoutes from "./routes/integration";

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true, app: "project-os-backend" }));

app.use("/auth", authRoutes);
app.use("/projects", projectsRoutes);
app.use("/boq", boqRoutes);
app.use("/budget", budgetRoutes);
app.use("/cost-categories", costCategoriesRoutes);
app.use("/procurement", procurementRoutes);
app.use("/inventory", inventoryRoutes);
app.use("/execution", executionRoutes);
app.use("/cost-visibility", costVisibilityRoutes);
app.use("/integration", integrationRoutes);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ message: "Unexpected server error." });
});

const port = Number(process.env.PORT) || 4100;
app.listen(port, () => {
  console.log(`Project OS backend listening on :${port}`);
});
