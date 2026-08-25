import test from "node:test";
import assert from "node:assert/strict";
import { composeBoard } from "./board-service.mjs";

test("initial board returns metrics without waiting for the action Agent", async () => {
  let agentCalls = 0;
  const dependencies = {
    getCards: async () => [{ id: "metrics", enabled: true, order: 1 }],
    getMetricCatalog: async () => [{ id: "sales_amount" }],
    getDemoIdentity: () => ({ id: "E001", role: "customer-manager" }),
    getBoardData: async () => ({
      snapshot: {
        identity: { id: "E001", role: "customer-manager" },
        period: "2026-08",
        asOf: "2026-08-25T00:00:00.000Z",
        metrics: { sales_amount: 10 },
        trend: [10],
        trendLabels: ["8月"],
        categoryMix: [],
      },
      source: { mode: "live", state: "ready", message: "EKP API v1" },
    }),
    generateActions: async () => {
      agentCalls += 1;
      return new Promise(() => {});
    },
  };

  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("initial board waited for Agent")), 50));
  const board = await Promise.race([
    composeBoard("customer-manager", { includeAgent: false }, dependencies),
    timeout,
  ]);

  assert.equal(agentCalls, 0);
  assert.equal(board.metrics.sales_amount, 10);
  assert.equal(board.agent.state, "pending");
});

test("agent refresh explicitly waits for and returns generated actions", async () => {
  let agentCalls = 0;
  const dependencies = {
    getCards: async () => [],
    getMetricCatalog: async () => [],
    getDemoIdentity: () => ({ id: "E001", role: "customer-manager" }),
    getBoardData: async () => ({
      snapshot: {
        identity: { id: "E001", role: "customer-manager" },
        period: "2026-08",
        asOf: "2026-08-25T00:00:00.000Z",
        metrics: {},
        trend: [],
      },
      source: { mode: "live", state: "ready", message: "EKP API v1" },
    }),
    generateActions: async (_snapshot, _catalog, options) => {
      agentCalls += 1;
      assert.equal(options.force, true);
      return { state: "ready", summary: "完成", actions: [], generatedAt: "2026-08-25T00:00:01.000Z" };
    },
  };

  const board = await composeBoard("customer-manager", { includeAgent: true, forceAgent: true }, dependencies);

  assert.equal(agentCalls, 1);
  assert.equal(board.agent.state, "ready");
});
