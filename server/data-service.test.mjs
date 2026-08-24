import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSnapshotFromResources,
  createAsyncTtlCache,
  extractRows,
  fetchAllRows,
  fetchScopedDeliveries,
  probeLiveData,
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

test("fetchAllRows retries a transient EKP API_RATE_LIMIT_EXCEEDED response", async () => {
  let requestCount = 0;
  const retryDelays = [];
  const fetchImpl = async () => {
    requestCount += 1;
    if (requestCount === 1) {
      return new Response(JSON.stringify({
        code: "API_RATE_LIMIT_EXCEEDED",
        message: "Too many requests",
        traceId: "trace-rate-limit",
      }), { status: 429, headers: { "content-type": "application/json", "retry-after": "0" } });
    }
    return new Response(JSON.stringify({
      code: "OK",
      data: { rows: [{ customerCode: "C1" }], page: 1, size: 500, total: 1 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const rows = await fetchAllRows({
    baseUrl: "http://example.test:8098",
    token: "secret-key",
    resource: "customer-employees",
    params: { employeeCode: "E001" },
    fetchImpl,
    retryBaseDelayMs: 0,
    sleepImpl: async (delayMs) => retryDelays.push(delayMs),
  });

  assert.deepEqual(rows, [{ customerCode: "C1" }]);
  assert.equal(requestCount, 2);
  assert.deepEqual(retryDelays, [0]);
});

test("fetchAllRows can return a bounded first page for direct EKP data probing", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    code: "OK",
    data: {
      rows: [{ billLineId: "L1" }, { billLineId: "L2" }],
      page: 1,
      size: 2,
      total: 99_999,
      totalPages: 50_000,
    },
  }), { status: 200, headers: { "content-type": "application/json" } });

  const rows = await fetchAllRows({
    baseUrl: "http://example.test:8098",
    token: "secret-key",
    resource: "sales-deliveries",
    pageSize: 2,
    maxPages: 1,
    pageLimitMode: "return",
    fetchImpl,
  });

  assert.deepEqual(rows, [{ billLineId: "L1" }, { billLineId: "L2" }]);
});

test("async TTL cache coalesces concurrent EKP snapshot loads", async () => {
  const loadCached = createAsyncTtlCache();
  let loadCount = 0;
  const loader = async () => {
    loadCount += 1;
    await Promise.resolve();
    return { snapshotId: loadCount };
  };

  const [first, concurrent] = await Promise.all([
    loadCached("employee:E001", { ttlMs: 60_000, loader, now: () => 1_000 }),
    loadCached("employee:E001", { ttlMs: 60_000, loader, now: () => 1_000 }),
  ]);
  const cached = await loadCached("employee:E001", { ttlMs: 60_000, loader, now: () => 2_000 });
  const refreshed = await loadCached("employee:E001", { ttlMs: 60_000, loader, now: () => 62_000 });

  assert.strictEqual(first, concurrent);
  assert.strictEqual(first, cached);
  assert.notStrictEqual(first, refreshed);
  assert.equal(loadCount, 2);
});

test("probeLiveData reads only the first page and diagnoses the existing EKP row shape", async (context) => {
  const envNames = [
    "DATA_API_TOKEN",
    "DATA_API_EMPLOYEE_CODE",
    "DATA_API_MAX_RETRIES",
    "DATA_API_PAGE_SIZE",
    "DATA_API_MAX_PAGES",
    "DATA_API_SALES_AMOUNT_FIELD",
  ];
  const previousEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  context.after(() => {
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  process.env.DATA_API_TOKEN = "secret-key";
  process.env.DATA_API_EMPLOYEE_CODE = "E001";
  process.env.DATA_API_MAX_RETRIES = "0";
  process.env.DATA_API_PAGE_SIZE = "500";
  process.env.DATA_API_MAX_PAGES = "40";
  process.env.DATA_API_SALES_AMOUNT_FIELD = "amount";

  const requests = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    requests.push(parsed);
    let rows;
    let total;
    if (parsed.pathname.endsWith("/customer-employees")) {
      rows = [{ employeeCode: "E001", customerCode: "C1", customerName: "客户一" }];
      total = 1;
    } else if (parsed.pathname.endsWith("/sales-targets")) {
      rows = [{ employeeCode: "E001", date: "2026-08-01T00:00:00", targetAmount: "1000.00" }];
      total = 1;
    } else {
      rows = [
        { billLineId: "L1", customerCode: "C1", billDate: "2026-08-20", amount: "10.00" },
        { billLineId: "L2", customerCode: "C1", billDate: "2026-08-19", amount: "20.00" },
      ];
      total = 50_000;
    }
    return new Response(JSON.stringify({
      code: "OK",
      data: { rows, page: 1, size: 5, total, totalPages: Math.ceil(total / 5) },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await probeLiveData({
    identity: { id: "demo", role: "customer-manager" },
    fetchImpl,
  });

  assert.equal(requests.length, 3);
  assert.ok(requests.every((url) => url.searchParams.get("page") === "1" && url.searchParams.get("size") === "5"));
  assert.equal(requests[2].searchParams.get("customerCode"), "C1");
  assert.equal(result.resources.salesDeliveries.returnedRows, 2);
  assert.equal(result.resources.salesDeliveries.total, 50_000);
  assert.equal(result.diagnostics.customerFilterMatches, true);
  assert.equal(result.diagnostics.billDateDescending, true);
  assert.deepEqual(result.diagnostics.availableAmountFields, ["amount"]);
  assert.equal(result.diagnostics.deliveryExceedsBoardPageLimit, true);
});

test("fetchScopedDeliveries queries each assigned customer and deduplicates delivery lines", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    requests.push(parsed);
    const customerCode = parsed.searchParams.get("customerCode");
    const rows = customerCode === "C1"
      ? [{ billLineId: "L1", customerCode }, { billLineId: "SHARED", customerCode }]
      : [{ billLineId: "L2", customerCode }, { billLineId: "SHARED", customerCode }];
    return new Response(JSON.stringify({
      code: "OK",
      data: { rows, page: 1, size: 500, total: rows.length },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await fetchScopedDeliveries({
    baseUrl: "http://example.test:8098",
    apiPrefix: "/open-api/v1",
    token: "secret-key",
    timeoutMs: 1000,
    pageSize: 500,
    maxPages: 40,
    employeeCode: "E001",
    relationshipRows: [
      { customerCode: "C1" },
      { customerCode: "C2" },
      { customerCode: "C1" },
    ],
    oldestRequiredPeriod: "2025-08",
    concurrency: 2,
    fetchImpl,
  });

  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map((url) => url.searchParams.get("customerCode")).sort(), ["C1", "C2"]);
  assert.ok(requests.every((url) => !url.searchParams.has("employeeCode")));
  assert.deepEqual(result.rows.map((row) => row.billLineId).sort(), ["L1", "L2", "SHARED"]);
  assert.equal(result.scope, "customerCode");
  assert.equal(result.queryCount, 2);
});

test("fetchScopedDeliveries exposes the customer code when one customer exceeds the page cap", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    code: "OK",
    data: { rows: [{ billLineId: "L1" }, { billLineId: "L2" }], page: 1, size: 2 },
  }), { status: 200, headers: { "content-type": "application/json" } });

  await assert.rejects(fetchScopedDeliveries({
    baseUrl: "http://example.test:8098",
    token: "secret-key",
    employeeCode: "E001",
    relationshipRows: [{ customerCode: "C-LARGE" }],
    oldestRequiredPeriod: "2025-08",
    pageSize: 2,
    maxPages: 1,
    fetchImpl,
  }), /sales-deliveries.*customerCode=C-LARGE/);
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
