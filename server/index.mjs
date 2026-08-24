import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { getCards, getMetricCatalog, createCard, updateCardMetrics } from "./card-store.mjs";
import { allowedRoles, getDemoIdentity } from "./demo-data.mjs";
import { getBoardData, probeLiveData } from "./data-service.mjs";
import { answerDataQuestion, generateActions } from "./agent.mjs";
import { adminTokenMatches } from "./auth.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env.local") });
dotenv.config({ path: path.join(root, ".env") });

const app = express();
app.use(cors({ origin: [/^http:\/\/127\.0\.0\.1:\d+$/, /^http:\/\/localhost:\d+$/] }));
app.use(express.json({ limit: "128kb" }));

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response)).catch(next);
}

function resolveRole(request) {
  const role = String(request.query.role || "customer-manager");
  if (!allowedRoles.includes(role)) throw Object.assign(new Error("身份不可用"), { status: 403 });
  return role;
}

function requireAdmin(request, response, next) {
  const configured = process.env.ADMIN_API_TOKEN;
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
  if (!adminTokenMatches(configured, supplied)) return response.status(403).json({ error: "仅管理员可修改卡片配置" });
  next();
}

async function composeBoard(role, forceAgent = false) {
  const [cards, catalog] = await Promise.all([getCards(), getMetricCatalog()]);
  const identity = getDemoIdentity(role);
  const { snapshot, source } = await getBoardData({ role, identity, catalog });
  const agent = await generateActions(snapshot, catalog, { force: forceAgent });
  return {
    identity: snapshot.identity,
    period: snapshot.period,
    asOf: snapshot.asOf,
    source,
    metrics: snapshot.metrics,
    trend: snapshot.trend,
    trendLabels: snapshot.trendLabels,
    categoryMix: snapshot.categoryMix,
    cards: cards.filter((card) => card.enabled).sort((a, b) => a.order - b.order),
    catalog,
    agent,
  };
}

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    dataApiMode: process.env.DATA_API_MODE || "auto",
    dataApiContract: "ekp-v1",
    dataApiEmployeeConfigured: Boolean(process.env.DATA_API_EMPLOYEE_CODE),
    deepSeekConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
  });
});

app.get("/api/data-check", asyncRoute(async (request, response) => {
  const role = resolveRole(request);
  const identity = getDemoIdentity(role);
  const { snapshot, source } = await getBoardData({ role, identity });
  response.json({
    ok: source.mode === "live" && source.state === "ready",
    identity: snapshot.identity,
    period: snapshot.period,
    asOf: snapshot.asOf,
    source,
    metrics: snapshot.metrics,
    availableMetricIds: snapshot.availableMetricIds || Object.keys(snapshot.metrics),
    unavailableMetricIds: snapshot.unavailableMetricIds || [],
    trendPointCount: snapshot.trend?.length || 0,
    factCount: snapshot.anomalies?.length || 0,
  });
}));

app.get("/api/data-probe", asyncRoute(async (request, response) => {
  const role = resolveRole(request);
  const identity = getDemoIdentity(role);
  const employeeCode = String(request.query.employeeCode || "").trim().slice(0, 128);
  const customerCode = String(request.query.customerCode || "").trim().slice(0, 128);
  const discoverEmployees = ["1", "true", "yes"].includes(String(request.query.discoverEmployees || "").toLowerCase());
  response.json(await probeLiveData({ identity, employeeCode, customerCode, discoverEmployees }));
}));

app.get("/api/board", asyncRoute(async (request, response) => {
  response.json(await composeBoard(resolveRole(request), false));
}));

app.post("/api/agent/refresh", asyncRoute(async (request, response) => {
  response.json(await composeBoard(resolveRole(request), true));
}));

app.post("/api/chat", asyncRoute(async (request, response) => {
  const role = resolveRole(request);
  const catalog = await getMetricCatalog();
  const identity = getDemoIdentity(role);
  const { snapshot } = await getBoardData({ role, identity, catalog });
  response.json(await answerDataQuestion({
    question: request.body.question,
    history: request.body.history,
    snapshot,
    catalog,
  }));
}));

app.use("/api/admin", requireAdmin);

app.get("/api/admin/catalog", asyncRoute(async (_request, response) => {
  response.json(await getMetricCatalog());
}));

app.get("/api/admin/cards", asyncRoute(async (_request, response) => {
  response.json(await getCards());
}));

app.post("/api/admin/cards", asyncRoute(async (request, response) => {
  response.status(201).json(await createCard(request.body));
}));

app.patch("/api/admin/cards/:id", asyncRoute(async (request, response) => {
  const allowed = { metricIds: request.body.metricIds, enabled: request.body.enabled };
  response.json(await updateCardMetrics(request.params.id, allowed));
}));

app.use(express.static(path.join(root, "dist")));
app.get(/^(?!\/api).*/, (_request, response) => response.sendFile(path.join(root, "dist", "index.html")));

app.use((error, _request, response, _next) => {
  const status = Number(error.status) || 500;
  response.status(status).json({ error: status >= 500 && !error.expose ? "服务暂时不可用" : error.message, detail: process.env.NODE_ENV === "development" ? error.detail || error.message : undefined });
});

const port = Number(process.env.PORT || 8787);
app.listen(port, "127.0.0.1", () => {
  console.log(`HMBI API listening on http://127.0.0.1:${port}`);
});
