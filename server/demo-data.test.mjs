import test from "node:test";
import assert from "node:assert/strict";
import { allowedRoles, getDemoSnapshot } from "./demo-data.mjs";

test("demo identities produce different row-level snapshots", () => {
  const snapshots = allowedRoles.map((role) => getDemoSnapshot(role));
  assert.equal(new Set(snapshots.map((item) => item.identity.id)).size, allowedRoles.length);
  assert.equal(new Set(snapshots.map((item) => item.metrics.sales_amount)).size, allowedRoles.length);
  assert.ok(snapshots.every((item) => item.anomalies.every((fact) => !/能力差|懒惰|责任心/.test(fact.fact))));
});
