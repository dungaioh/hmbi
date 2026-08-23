import test from "node:test";
import assert from "node:assert/strict";
import { normalizeActions, selectMetrics } from "./agent.mjs";

test("chat data tool only returns catalog-approved metrics", () => {
  const snapshot = { metrics: { sales: 100, hidden: 999 }, asOf: "2026-08-22", identity: {} };
  const catalog = [{ id: "sales", name: "销售额", unit: "万元" }];
  assert.deepEqual(selectMetrics(snapshot, catalog, ["hidden", "sales", "sales"]), [
    { id: "sales", name: "销售额", value: 100, unit: "万元", asOf: "2026-08-22" },
  ]);
});

test("generated actions are anchored to server-provided EKP facts", () => {
  const facts = [{
    factId: "fact-1",
    customer: "真实客户",
    category: "客户活跃",
    fact: "2026-08 的有效出库明细中未发现该客户记录。",
    metricIds: ["active_customers"],
  }];
  const normalized = normalizeActions({
    summary: "建议优先跟进。",
    actions: [
      { factId: "fact-1", priority: "high", customer: "虚构客户", fact: "虚构数字", metricIds: ["hidden"], actionType: "客户唤醒", rationale: "确认本期需求。", confidence: 0.8 },
      { factId: "missing", priority: "high", actionType: "错误动作" },
    ],
  }, "abcdef123456", facts);

  assert.equal(normalized.actions.length, 1);
  assert.equal(normalized.actions[0].customer, "真实客户");
  assert.equal(normalized.actions[0].fact, facts[0].fact);
  assert.deepEqual(normalized.actions[0].metricIds, ["active_customers"]);
});
