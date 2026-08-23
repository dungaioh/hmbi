import test from "node:test";
import assert from "node:assert/strict";
import { selectMetrics } from "./agent.mjs";

test("chat data tool only returns catalog-approved metrics", () => {
  const snapshot = { metrics: { sales: 100, hidden: 999 }, asOf: "2026-08-22", identity: {} };
  const catalog = [{ id: "sales", name: "销售额", unit: "万元" }];
  assert.deepEqual(selectMetrics(snapshot, catalog, ["hidden", "sales", "sales"]), [
    { id: "sales", name: "销售额", value: 100, unit: "万元", asOf: "2026-08-22" },
  ]);
});
