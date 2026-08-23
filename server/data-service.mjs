import { getDemoSnapshot } from "./demo-data.mjs";

const DEFAULT_API_PREFIX = "/open-api/v1";
const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_MAX_PAGES = 40;
const DEFAULT_TIMEOUT_MS = 15_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ALL_METRIC_IDS = [
  "seasonal_attainment",
  "seasonal_target",
  "seasonal_achieved",
  "seasonal_gap",
  "days_remaining",
  "daily_required",
  "active_customers",
  "total_customers",
  "distribution_rate",
  "new_distribution_rate",
  "sales_amount",
  "sales_yoy",
  "collection_rate",
  "inventory_turnover",
];
const AMOUNT_FIELD_CANDIDATES = [
  "salesAmount",
  "saleAmount",
  "deliveryAmount",
  "amount",
  "lineAmount",
  "totalAmount",
  "netAmount",
  "amountWithTax",
  "taxInclusiveAmount",
  "taxAmount",
];

function exposedError(message, { status = 502, detail, code, traceId } = {}) {
  return Object.assign(new Error(message), { status, expose: true, detail, code, traceId });
}

export function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.data?.records)) return payload.data.records;
  if (Array.isArray(payload?.data?.content)) return payload.data.content;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload?.result?.data)) return payload.result.data;
  if (Array.isArray(payload?.result?.rows)) return payload.result.rows;
  if (Array.isArray(payload?.result?.records)) return payload.result.records;
  return [];
}

function pageMetadata(payload) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const total = Number(data?.total ?? data?.totalElements ?? data?.totalCount);
  const totalPages = Number(data?.totalPages ?? data?.pages);
  return {
    total: Number.isFinite(total) ? total : null,
    totalPages: Number.isFinite(totalPages) ? totalPages : null,
    hasMore: typeof data?.hasMore === "boolean" ? data.hasMore : null,
  };
}

async function parseResponse(response, resource) {
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw exposedError(`EKP ${resource} 返回了非 JSON 响应`, {
        detail: `HTTP ${response.status}`,
      });
    }
  }

  if (!response.ok || (payload?.code && payload.code !== "OK")) {
    const upstreamCode = payload?.code || `HTTP_${response.status}`;
    const traceId = payload?.traceId;
    const upstreamMessage = payload?.message || response.statusText || "请求失败";
    throw exposedError(`EKP ${resource} 请求失败：${upstreamCode}`, {
      detail: `${upstreamMessage}${traceId ? ` · traceId=${traceId}` : ""}`,
      code: upstreamCode,
      traceId,
    });
  }
  return payload;
}

export async function fetchAllRows({
  baseUrl,
  apiPrefix = DEFAULT_API_PREFIX,
  token,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  resource,
  params = {},
  pageSize = DEFAULT_PAGE_SIZE,
  maxPages = DEFAULT_MAX_PAGES,
  fetchImpl = fetch,
  stopAfterPage,
}) {
  if (!token) {
    throw exposedError("未配置 EKP API Key，请在 .env.local 设置 DATA_API_TOKEN", { status: 503 });
  }
  const rows = [];
  const safeSize = Math.max(1, Math.min(500, Number(pageSize) || DEFAULT_PAGE_SIZE));
  const safeMaxPages = Math.max(1, Number(maxPages) || DEFAULT_MAX_PAGES);

  for (let page = 1; page <= safeMaxPages; page += 1) {
    const prefix = `/${String(apiPrefix).replace(/^\/+|\/+$/g, "")}`;
    const path = `${prefix}/${String(resource).replace(/^\/+/, "")}`;
    const url = new URL(path, `${String(baseUrl).replace(/\/$/, "")}/`);
    for (const [key, value] of Object.entries({ ...params, page, size: safeSize })) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let payload;
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          "X-API-Key": token,
        },
        signal: controller.signal,
      });
      payload = await parseResponse(response, resource);
    } catch (error) {
      if (error?.expose) throw error;
      if (error?.name === "AbortError") {
        throw exposedError(`EKP ${resource} 请求超时`, { detail: `超过 ${timeoutMs}ms` });
      }
      throw exposedError(`无法连接 EKP ${resource}`, {
        detail: error instanceof Error ? error.message : "网络错误",
      });
    } finally {
      clearTimeout(timeout);
    }

    const pageRows = extractRows(payload);
    rows.push(...pageRows);
    const meta = pageMetadata(payload);

    if (stopAfterPage?.(pageRows, rows)) break;
    if (meta.hasMore === false) break;
    if (meta.total !== null && rows.length >= meta.total) break;
    if (meta.totalPages !== null && page >= meta.totalPages) break;
    if (pageRows.length < safeSize) break;
    if (page === safeMaxPages) {
      throw exposedError(`EKP ${resource} 超过分页安全上限`, {
        detail: `已读取 ${rows.length} 行；可通过 DATA_API_MAX_PAGES 调整上限`,
      });
    }
  }
  return rows;
}

function uniqueCustomerCodes(rows) {
  return [...new Set(rows
    .map((row) => String(row?.customerCode || "").trim())
    .filter(Boolean))];
}

function deduplicateDeliveryRows(rows) {
  const seenLineIds = new Set();
  return rows.filter((row) => {
    const lineId = String(row?.billLineId || "").trim();
    if (!lineId) return true;
    if (seenLineIds.has(lineId)) return false;
    seenLineIds.add(lineId);
    return true;
  });
}

export async function fetchScopedDeliveries({
  baseUrl,
  apiPrefix = DEFAULT_API_PREFIX,
  token,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pageSize = DEFAULT_PAGE_SIZE,
  maxPages = DEFAULT_MAX_PAGES,
  employeeCode,
  relationshipRows = [],
  oldestRequiredPeriod,
  concurrency = 3,
  fetchImpl = fetch,
}) {
  const customerCodes = uniqueCustomerCodes(relationshipRows);
  const common = {
    baseUrl,
    apiPrefix,
    token,
    timeoutMs,
    pageSize,
    maxPages,
    resource: "sales-deliveries",
    fetchImpl,
    stopAfterPage: (pageRows) => {
      const datedRows = pageRows.map((row) => monthKey(row?.billDate)).filter(Boolean);
      return datedRows.length > 0 && datedRows.every((key) => key < oldestRequiredPeriod);
    },
  };

  if (!customerCodes.length) {
    const rows = await fetchAllRows({
      ...common,
      params: { employeeCode, isDeleted: 0, sortBy: "billDate", direction: "desc" },
    });
    return { rows: deduplicateDeliveryRows(rows), scope: "employeeCode", queryCount: 1 };
  }

  const results = new Array(customerCodes.length);
  let nextIndex = 0;
  const safeConcurrency = Math.max(1, Math.min(customerCodes.length, Number(concurrency) || 3));
  async function worker() {
    while (nextIndex < customerCodes.length) {
      const index = nextIndex;
      nextIndex += 1;
      const customerCode = customerCodes[index];
      try {
        results[index] = await fetchAllRows({
          ...common,
          params: { customerCode, isDeleted: 0, sortBy: "billDate", direction: "desc" },
        });
      } catch (error) {
        if (error?.expose) {
          error.message = `${error.message}（customerCode=${customerCode}）`;
          error.detail = `customerCode=${customerCode}${error.detail ? `；${error.detail}` : ""}`;
        }
        throw error;
      }
    }
  }
  await Promise.all(Array.from({ length: safeConcurrency }, () => worker()));

  return {
    rows: deduplicateDeliveryRows(results.flat()),
    scope: "customerCode",
    queryCount: customerCodes.length,
  };
}

function currentPeriod(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function validPeriod(value, now) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || "")) ? String(value) : currentPeriod(now);
}

function monthKey(value) {
  const text = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})/.exec(text);
  if (match) return `${match[1]}-${match[2]}`;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : currentPeriod(date);
}

function previousYearPeriod(period) {
  return `${Number(period.slice(0, 4)) - 1}-${period.slice(5)}`;
}

function monthsEnding(period, count = 7) {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5)) - 1;
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - (count - index - 1), 1));
    return currentPeriod(date);
  });
}

function decimalToCents(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).replace(/,/g, "").trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const fraction = `${match[3] || ""}00`;
  let cents = BigInt(match[2]) * 100n + BigInt(fraction.slice(0, 2));
  if (Number(fraction[2] || 0) >= 5) cents += 1n;
  return match[1] ? -cents : cents;
}

function sumMoney(rows, field, divisor) {
  let cents = 0n;
  for (const row of rows) {
    const value = decimalToCents(row?.[field]);
    if (value !== null) cents += value;
  }
  return Number(cents) / 100 / divisor;
}

function rounded(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function isDeleted(row) {
  return row?.isDeleted === 1 || row?.isDeleted === true || String(row?.isDeleted).toLowerCase() === "true" || row?.isDeleted === "1";
}

function contains(value, expected) {
  if (!expected) return true;
  return String(value ?? "").toLocaleLowerCase("zh-CN").includes(String(expected).toLocaleLowerCase("zh-CN"));
}

function matchesSeason(row, config) {
  return contains(row?.productLine, config.seasonalProductLine)
    && contains(row?.categoryName, config.seasonalCategory);
}

function targetMatchesPeriod(row, period) {
  const rowPeriod = monthKey(row?.date);
  if (!rowPeriod) return false;
  return String(row?.timeCategory || "").includes("年")
    ? rowPeriod.slice(0, 4) === period.slice(0, 4)
    : rowPeriod === period;
}

function detectAmountField(rows, configured) {
  if (configured) return configured;
  return AMOUNT_FIELD_CANDIDATES.find((field) => rows.some((row) => row && Object.hasOwn(row, field))) || null;
}

function calculateDaysRemaining(period, deadlineValue, now) {
  const defaultDeadline = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5)), 0));
  const configured = deadlineValue ? new Date(`${deadlineValue}T00:00:00Z`) : defaultDeadline;
  const deadline = Number.isNaN(configured.getTime()) ? defaultDeadline : configured;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.max(0, Math.ceil((deadline.getTime() - today.getTime()) / DAY_MS));
}

function categoryMix(rows, amountField, amountDivisor) {
  if (!amountField) return [];
  const totals = new Map();
  for (const row of rows) {
    const name = String(row?.categoryName || row?.productLine || "其他");
    const cents = decimalToCents(row?.[amountField]);
    if (cents !== null) totals.set(name, (totals.get(name) || 0n) + cents);
  }
  const total = [...totals.values()].reduce((sum, value) => sum + value, 0n);
  if (total <= 0n) return [];
  return [...totals.entries()]
    .sort((a, b) => (a[1] === b[1] ? 0 : a[1] > b[1] ? -1 : 1))
    .slice(0, 5)
    .map(([name, cents]) => ({
      name,
      value: Number(cents) / 100 / amountDivisor,
      share: rounded(Number(cents * 10_000n / total) / 100, 2),
    }));
}

export function buildSnapshotFromResources({
  identity,
  relationshipRows,
  targetRows,
  deliveryRows,
  config,
  now = new Date(),
}) {
  const period = validPeriod(config.period, now);
  const priorPeriod = previousYearPeriod(period);
  const amountDivisor = Number(config.amountDivisor) > 0 ? Number(config.amountDivisor) : 10_000;
  const amountField = detectAmountField(deliveryRows, config.amountField);
  const validDeliveries = deliveryRows.filter((row) => !isDeleted(row));
  const currentDeliveries = validDeliveries.filter((row) => monthKey(row?.billDate) === period);
  const priorDeliveries = validDeliveries.filter((row) => monthKey(row?.billDate) === priorPeriod);
  const seasonalTargets = targetRows.filter((row) => targetMatchesPeriod(row, period) && matchesSeason(row, config));
  const seasonalDeliveries = currentDeliveries.filter((row) => matchesSeason(row, config));
  const metrics = {};

  metrics.seasonal_target = rounded(sumMoney(seasonalTargets, "targetAmount", amountDivisor));
  metrics.days_remaining = calculateDaysRemaining(period, config.seasonalDeadline, now);
  metrics.total_customers = new Set(relationshipRows.map((row) => row?.customerCode).filter(Boolean)).size;

  const currentCustomerCodes = new Set(currentDeliveries.map((row) => row?.customerCode).filter(Boolean));
  const assignedCustomerCodes = new Set(relationshipRows.map((row) => row?.customerCode).filter(Boolean));
  const activeCustomerCodes = assignedCustomerCodes.size
    ? new Set([...currentCustomerCodes].filter((code) => assignedCustomerCodes.has(code)))
    : currentCustomerCodes;
  metrics.active_customers = activeCustomerCodes.size;
  if (metrics.total_customers > 0) {
    metrics.distribution_rate = rounded(metrics.active_customers / metrics.total_customers * 100);
  }

  if (config.newProductMatch && metrics.total_customers > 0) {
    const newProductCustomers = new Set(currentDeliveries
      .filter((row) => [row?.productName, row?.spuName, row?.productLine].some((value) => contains(value, config.newProductMatch)))
      .map((row) => row?.customerCode)
      .filter((code) => code && assignedCustomerCodes.has(code)));
    metrics.new_distribution_rate = rounded(newProductCustomers.size / metrics.total_customers * 100);
  }

  if (amountField) {
    metrics.sales_amount = rounded(sumMoney(currentDeliveries, amountField, amountDivisor));
    const priorAmount = sumMoney(priorDeliveries, amountField, amountDivisor);
    if (priorAmount !== 0) metrics.sales_yoy = rounded((metrics.sales_amount - priorAmount) / Math.abs(priorAmount) * 100);
    metrics.seasonal_achieved = rounded(sumMoney(seasonalDeliveries, amountField, amountDivisor));
    metrics.seasonal_gap = rounded(Math.max(0, metrics.seasonal_target - metrics.seasonal_achieved));
    if (metrics.seasonal_target > 0) {
      metrics.seasonal_attainment = rounded(metrics.seasonal_achieved / metrics.seasonal_target * 100);
    }
    if (metrics.days_remaining > 0) {
      metrics.daily_required = rounded(metrics.seasonal_gap / metrics.days_remaining);
    }
  }

  const trendLabels = monthsEnding(period);
  const trend = amountField
    ? trendLabels.map((key) => rounded(sumMoney(validDeliveries.filter((row) => monthKey(row?.billDate) === key), amountField, amountDivisor)))
    : [];
  const mix = categoryMix(currentDeliveries, amountField, amountDivisor);

  const employeeName = relationshipRows.find((row) => row?.employeeName)?.employeeName
    || targetRows.find((row) => row?.employeeName)?.employeeName;
  const area = targetRows.find((row) => row?.area)?.area;
  const liveIdentity = {
    ...identity,
    id: String(config.employeeCode || identity.id),
    name: String(employeeName || identity.name),
    orgName: String(area || identity.orgName),
  };

  const anomalies = [];
  if (metrics.seasonal_attainment !== undefined) {
    anomalies.push({
      customer: config.seasonalProductLine || config.seasonalCategory || "季节品",
      category: "季节达成",
      fact: `本期目标 ${metrics.seasonal_target} 万元，已出库 ${metrics.seasonal_achieved} 万元，达成 ${rounded(metrics.seasonal_attainment, 1)}%，缺口 ${metrics.seasonal_gap} 万元。`,
      metricIds: ["seasonal_target", "seasonal_achieved", "seasonal_attainment", "seasonal_gap"],
    });
  }
  for (const row of relationshipRows.filter((item) => item?.customerCode && !activeCustomerCodes.has(item.customerCode)).slice(0, 3)) {
    anomalies.push({
      customer: String(row.customerName || row.customerCode),
      category: "客户活跃",
      fact: `${period} 的销售出库明细中未发现该责任客户的有效出库记录。`,
      metricIds: ["active_customers", "total_customers"],
    });
  }
  if (metrics.sales_yoy !== undefined) {
    anomalies.push({
      customer: liveIdentity.orgName,
      category: "销售同比",
      fact: `${period} 出库额 ${metrics.sales_amount} 万元，较上年同期${metrics.sales_yoy >= 0 ? "增加" : "减少"} ${Math.abs(rounded(metrics.sales_yoy, 1))}%。`,
      metricIds: ["sales_amount", "sales_yoy"],
    });
  }

  const availableMetricIds = Object.keys(metrics);
  return {
    identity: liveIdentity,
    metrics,
    trend,
    trendLabels,
    categoryMix: mix,
    anomalies,
    period,
    asOf: now.toISOString(),
    availableMetricIds,
    unavailableMetricIds: ALL_METRIC_IDS.filter((id) => !availableMetricIds.includes(id)),
    diagnostics: {
      rowCounts: {
        salesDeliveries: deliveryRows.length,
        customerEmployees: relationshipRows.length,
        salesTargets: targetRows.length,
      },
      amountField,
    },
  };
}

function dataConfig(identity, now = new Date()) {
  const employeeCode = String(process.env.DATA_API_EMPLOYEE_CODE || identity.id).trim();
  return {
    baseUrl: process.env.DATA_API_BASE_URL || "http://183.63.194.18:8098",
    apiPrefix: process.env.DATA_API_PREFIX || DEFAULT_API_PREFIX,
    token: process.env.DATA_API_TOKEN,
    timeoutMs: Number(process.env.DATA_API_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    maxPages: Number(process.env.DATA_API_MAX_PAGES || DEFAULT_MAX_PAGES),
    pageSize: Number(process.env.DATA_API_PAGE_SIZE || DEFAULT_PAGE_SIZE),
    deliveryConcurrency: Number(process.env.DATA_API_DELIVERY_CONCURRENCY || 3),
    employeeCode,
    period: validPeriod(process.env.DATA_API_PERIOD, now),
    amountField: String(process.env.DATA_API_SALES_AMOUNT_FIELD || "").trim(),
    amountDivisor: Number(process.env.DATA_API_AMOUNT_DIVISOR || 10_000),
    seasonalProductLine: String(process.env.DATA_API_SEASONAL_PRODUCT_LINE || "月饼").trim(),
    seasonalCategory: String(process.env.DATA_API_SEASONAL_CATEGORY || "").trim(),
    seasonalDeadline: String(process.env.DATA_API_SEASONAL_DEADLINE || "").trim(),
    newProductMatch: String(process.env.DATA_API_NEW_PRODUCT_MATCH || "").trim(),
  };
}

async function fetchLiveSnapshot({ identity }) {
  const now = new Date();
  const config = dataConfig(identity, now);
  const common = {
    baseUrl: config.baseUrl,
    apiPrefix: config.apiPrefix,
    token: config.token,
    timeoutMs: config.timeoutMs,
    pageSize: config.pageSize,
    maxPages: config.maxPages,
  };
  const oldestRequiredPeriod = previousYearPeriod(config.period);

  const [relationshipRows, targetRows] = await Promise.all([
    fetchAllRows({
      ...common,
      resource: "customer-employees",
      params: { employeeCode: config.employeeCode, sortBy: "customerCode", direction: "asc" },
    }),
    fetchAllRows({
      ...common,
      resource: "sales-targets",
      params: {
        employeeCode: config.employeeCode,
        productLineContains: config.seasonalProductLine,
        categoryNameContains: config.seasonalCategory,
        sortBy: "date",
        direction: "desc",
      },
    }),
  ]);
  const deliveryResult = await fetchScopedDeliveries({
    ...common,
    employeeCode: config.employeeCode,
    relationshipRows,
    oldestRequiredPeriod,
    concurrency: config.deliveryConcurrency,
  });
  const deliveryRows = deliveryResult.rows;

  if (!relationshipRows.length && !targetRows.length && !deliveryRows.length) {
    throw exposedError("EKP API 未返回当前员工范围的数据", {
      detail: "请检查 DATA_API_EMPLOYEE_CODE 是否为真实员工工号",
    });
  }

  const snapshot = buildSnapshotFromResources({ identity, relationshipRows, targetRows, deliveryRows, config, now });
  snapshot.diagnostics.deliveryScope = deliveryResult.scope;
  snapshot.diagnostics.deliveryQueryCount = deliveryResult.queryCount;
  return snapshot;
}

export async function getBoardData({ role, identity }) {
  const mode = process.env.DATA_API_MODE || "auto";
  if (mode === "demo") {
    const snapshot = getDemoSnapshot(role);
    return { snapshot, source: { mode: "demo", state: "ready", message: "演示视图" } };
  }
  try {
    const snapshot = await fetchLiveSnapshot({ identity });
    const counts = snapshot.diagnostics.rowCounts;
    const missing = snapshot.unavailableMetricIds.length
      ? `；未开放/未配置指标：${snapshot.unavailableMetricIds.join(", ")}`
      : "";
    return {
      snapshot,
      source: {
        mode: "live",
        state: "ready",
        message: "EKP API v1",
        detail: `出库 ${counts.salesDeliveries} 行，客户关系 ${counts.customerEmployees} 行，目标 ${counts.salesTargets} 行${missing}`,
        diagnostics: snapshot.diagnostics,
      },
    };
  } catch (error) {
    if (mode === "live") throw error;
    return {
      snapshot: getDemoSnapshot(role),
      source: {
        mode: "demo",
        state: "fallback",
        message: "真实接口暂不可用，当前为标记后的演示视图",
        detail: error instanceof Error ? error.message : "未知错误",
      },
    };
  }
}
