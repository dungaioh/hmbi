import { getDemoSnapshot } from "./demo-data.mjs";

export function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload?.result?.data)) return payload.result.data;
  if (Array.isArray(payload?.result?.rows)) return payload.result.rows;
  if (Array.isArray(payload?.result?.records)) return payload.result.records;
  return [];
}

function metricMapFromRows(catalog, viewRows) {
  const metrics = {};
  for (const metric of catalog) {
    const row = viewRows.get(metric.view)?.[0];
    if (!row || row[metric.field] === undefined) continue;
    const value = Number(row[metric.field]);
    metrics[metric.id] = Number.isFinite(value) ? value : row[metric.field];
  }
  return metrics;
}

async function fetchView({ baseUrl, queryPath, token, timeoutMs, view, fields, identity }) {
  const url = new URL(queryPath, `${baseUrl.replace(/\/$/, "")}/`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        view,
        fields,
        filters: {
          employeeId: identity.id,
          role: identity.role,
          orgCode: identity.orgCode,
        },
        limit: 200,
        readOnly: true,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`数据接口返回 ${response.status}`);
    return extractRows(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLiveSnapshot({ identity, catalog }) {
  const baseUrl = process.env.DATA_API_BASE_URL || "http://183.63.194.18:8098";
  const queryPath = process.env.DATA_API_QUERY_PATH || "/open-api/query";
  const token = process.env.DATA_API_TOKEN;
  const timeoutMs = Number(process.env.DATA_API_TIMEOUT_MS || 4500);
  const fieldsByView = new Map();
  for (const metric of catalog) {
    const fields = fieldsByView.get(metric.view) ?? new Set();
    fields.add(metric.field);
    fieldsByView.set(metric.view, fields);
  }
  fieldsByView.set("demo_sales_anomalies", new Set(["customer", "category", "fact", "metric_ids"]));
  fieldsByView.set("demo_sales_trend", new Set(["period", "sales_amount"]));

  const entries = await Promise.all(
    [...fieldsByView.entries()].map(async ([view, fields]) => [
      view,
      await fetchView({ baseUrl, queryPath, token, timeoutMs, view, fields: [...fields], identity }),
    ]),
  );
  const rows = new Map(entries);
  const metrics = metricMapFromRows(catalog, rows);
  if (!Object.keys(metrics).length) throw new Error("接口返回中未找到已配置指标字段");

  return {
    identity,
    metrics,
    trend: (rows.get("demo_sales_trend") ?? []).map((row) => Number(row.sales_amount)).filter(Number.isFinite),
    anomalies: (rows.get("demo_sales_anomalies") ?? []).map((row) => ({
      customer: String(row.customer || "未命名对象"),
      category: String(row.category || "经营提醒"),
      fact: String(row.fact || ""),
      metricIds: Array.isArray(row.metric_ids) ? row.metric_ids : [],
    })),
    period: new Date().toISOString().slice(0, 7),
    asOf: new Date().toISOString(),
  };
}

export async function getBoardData({ role, identity, catalog }) {
  const mode = process.env.DATA_API_MODE || "auto";
  if (mode === "demo") {
    return { snapshot: getDemoSnapshot(role), source: { mode: "demo", state: "ready", message: "演示视图" } };
  }
  try {
    const snapshot = await fetchLiveSnapshot({ identity, catalog });
    return { snapshot, source: { mode: "live", state: "ready", message: "只读数据 API" } };
  } catch (error) {
    if (mode === "live") throw error;
    return {
      snapshot: getDemoSnapshot(role),
      source: {
        mode: "demo",
        state: "fallback",
        message: "真实接口暂不可达，当前为标记后的演示视图",
        detail: error instanceof Error ? error.message : "未知错误",
      },
    };
  }
}
