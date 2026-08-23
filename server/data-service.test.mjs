import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSnapshotFromResources,
  extractRows,
  fetchAllRows,
} from "./data-service.mjs";

test("extractRows supports the EKP data.rows response envelope", () => {
  const rows = [{ value: 1 }];
  assert.deepEqual(extractRows(rows), rows);
  assert.deepEqual(extractRows({ data: rows }), rows);
  assert.deepEqual(extractRows({ data: { rows } }), rows);
  assert.deepEqual(extractRows({ result: { records: rows } }), rows);
  assert.deepEqual(extractRows({ unknown: rows }), []);
});

test("fetchAllRows follows EKP GET, X-API-Key and page query contract", async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), init });
    const page = Number(new URL(url).searchParams.get("page"));
    const rows = page === 1 ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }];
    return new Response(JSON.stringify({
      code: "OK",
      message: "success",
      data: { rows, page, size: 2, total: 3 },
      traceId: `trace-${page}`,
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const rows = await fetchAllRows({
    baseUrl: "http://example.test:8098",
    apiPrefix: "/open-api/v1",
    token: "secret-key",
    timeoutMs: 1000,
    resource: "sales-targets",
    params: { employeeCode: "E001" },
    pageSize: 2,
    maxPages: 5,
    fetchImpl,
  });

  assert.deepEqual(rows, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].init.method, "GET");
  assert.equal(requests[0].init.headers["X-API-Key"], "secret-key");
  assert.equal(requests[0].init.headers.authorization, undefined);
  assert.equal(new URL(requests[0].url).pathname, "/open-api/v1/sales-targets");
  assert.equal(new URL(requests[0].url).searchParams.get("employeeCode"), "E001");
  assert.equal(new URL(requests[1].url).searchParams.get("page"), "2");
});

test("buildSnapshotFromResources derives BI metrics and agent facts from EKP rows", () => {
  const identity = {
    id: "E001",
    role: "customer-manager",
    roleName: "客户经理",
    name: "模拟姓名",
    orgCode: "TEST",
    orgName: "测试范围",
  };
  const snapshot = buildSnapshotFromResources({
    identity,
    relationshipRows: [
      { employeeCode: "E001", employeeName: "真实员工", customerCode: "C1", customerName: "客户一" },
      { employeeCode: "E001", employeeName: "真实员工", customerCode: "C2", customerName: "客户二" },
      { employeeCode: "E001", employeeName: "真实员工", customerCode: "C3", customerName: "客户三" },
    ],
    targetRows: [
      { employeeCode: "E001", employeeName: "真实员工", area: "华东", productLine: "月饼", date: "2026-08-01T00:00:00", targetAmount: "100000.00" },
    ],
    deliveryRows: [
      { customerCode: "C1", customerName: "客户一", productLine: "月饼", productName: "经典月饼", billDate: "2026-08-10", amount: "30000.00", isDeleted: 0 },
      { customerCode: "C2", customerName: "客户二", productLine: "面包", productName: "重点新品吐司", billDate: "2026-08-12", amount: "20000.00", isDeleted: 0 },
      { customerCode: "C1", customerName: "客户一", productLine: "月饼", productName: "经典月饼", billDate: "2025-08-10", amount: "25000.00", isDeleted: 0 },
      { customerCode: "C3", customerName: "客户三", productLine: "月饼", productName: "作废记录", billDate: "2026-08-15", amount: "99999.00", isDeleted: 1 },
    ],
    config: {
      period: "2026-08",
      amountField: "amount",
      amountDivisor: 10000,
      seasonalProductLine: "月饼",
      seasonalCategory: "",
      seasonalDeadline: "2026-08-31",
      newProductMatch: "新品",
    },
    now: new Date("2026-08-23T00:00:00Z"),
  });

  assert.equal(snapshot.identity.id, "E001");
  assert.equal(snapshot.identity.name, "真实员工");
  assert.equal(snapshot.period, "2026-08");
  assert.equal(snapshot.metrics.seasonal_target, 10);
  assert.equal(snapshot.metrics.seasonal_achieved, 3);
  assert.equal(snapshot.metrics.seasonal_gap, 7);
  assert.equal(snapshot.metrics.seasonal_attainment, 30);
  assert.equal(snapshot.metrics.days_remaining, 8);
  assert.equal(snapshot.metrics.sales_amount, 5);
  assert.equal(snapshot.metrics.sales_yoy, 100);
  assert.equal(snapshot.metrics.active_customers, 2);
  assert.equal(snapshot.metrics.total_customers, 3);
  assert.ok(Math.abs(snapshot.metrics.distribution_rate - 66.6666667) < 0.001);
  assert.ok(Math.abs(snapshot.metrics.new_distribution_rate - 33.3333333) < 0.001);
  assert.deepEqual(snapshot.trend.slice(-2), [0, 5]);
  assert.ok(snapshot.anomalies.some((fact) => fact.customer === "客户三" && fact.category === "客户活跃"));
  assert.ok(snapshot.anomalies.some((fact) => fact.category === "季节达成"));
  assert.ok(snapshot.availableMetricIds.includes("sales_amount"));
  assert.ok(snapshot.unavailableMetricIds.includes("collection_rate"));
});
