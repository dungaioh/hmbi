import { createHash } from "node:crypto";
import OpenAI from "openai";

const cache = new Map();
const cacheTtlMs = 15 * 60 * 1000;

function createDeepSeekClient() {
  return new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    timeout: 30_000,
    maxRetries: 1,
  });
}

function modelName() {
  return process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
}

function hashSnapshot(snapshot) {
  return createHash("sha256")
    .update(JSON.stringify({ identity: snapshot.identity, metrics: snapshot.metrics, anomalies: snapshot.anomalies, asOf: snapshot.asOf }))
    .digest("hex");
}

function getCached(key) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.createdAt < cacheTtlMs) return cached.value;
  cache.delete(key);
  return null;
}

function parseJson(content) {
  if (!content) throw new Error("模型没有返回内容");
  return JSON.parse(content.replace(/^```json\s*|\s*```$/g, ""));
}

export function normalizeActions(payload, key, detectedFacts = []) {
  const priorities = new Set(["high", "medium", "low"]);
  const facts = new Map(detectedFacts.map((fact) => [fact.factId, fact]));
  const actions = Array.isArray(payload.actions) ? payload.actions.slice(0, 5) : [];
  const normalizedActions = actions
    .flatMap((action, index) => {
      if (!action || typeof action !== "object") return [];
      const fact = facts.get(String(action.factId || ""));
      if (!fact) return [];
      return [{
        id: `${key.slice(0, 8)}-${index}`,
        priority: priorities.has(action.priority) ? action.priority : "medium",
        customer: String(fact.customer || "经营对象"),
        category: String(fact.category || "经营提醒"),
        fact: String(fact.fact || ""),
        actionType: String(action.actionType || "跟进确认"),
        rationale: String(action.rationale || "确认事实并安排下一步动作。"),
        metricIds: Array.isArray(fact.metricIds) ? fact.metricIds.map(String) : [],
        confidence: Math.max(0, Math.min(1, Number(action.confidence) || 0)),
      }];
    })
    .filter((action) => action.fact);
  return {
    summary: normalizedActions.length
      ? `Agent 已基于 ${normalizedActions.length} 条 EKP 数据事实完成行动排序。`
      : "当前没有足够的 EKP 数据事实生成行动建议。",
    actions: normalizedActions,
  };
}

function classifyDeepSeekError(error) {
  const message = error instanceof Error ? error.message : "未知错误";
  const isQuota = /current quota|insufficient_quota|balance|credits/i.test(message);
  const isAuth = /invalid_api_key|401|authentication|unauthorized/i.test(message);
  return {
    errorCode: isQuota ? "insufficient_quota" : isAuth ? "authentication_error" : "agent_error",
    summary: isQuota
      ? "DeepSeek API 余额不足；充值后即可重新分析。"
      : isAuth
        ? "DeepSeek API 鉴权失败；请检查服务端密钥配置。"
        : "Agent 暂时无法生成建议；页面不会用静态规则冒充 AI 建议。",
    detail: isQuota ? "请检查 DeepSeek 开放平台余额。" : message,
  };
}

export async function generateActions(snapshot, catalog, { force = false } = {}) {
  if (!process.env.DEEPSEEK_API_KEY) {
    return { state: "unavailable", summary: "DeepSeek Agent 未配置", actions: [], generatedAt: null };
  }
  const key = hashSnapshot(snapshot);
  if (!force) {
    const cached = getCached(key);
    if (cached) return { ...cached, cached: true };
  }

  const metricContext = catalog
    .filter((metric) => snapshot.metrics[metric.id] !== undefined)
    .map((metric) => ({ id: metric.id, name: metric.name, value: snapshot.metrics[metric.id], unit: metric.unit }));
  const detectedFacts = (snapshot.anomalies || []).map((fact, index) => ({
    factId: `fact-${index + 1}`,
    customer: fact.customer,
    category: fact.category,
    fact: fact.fact,
    metricIds: fact.metricIds,
  }));

  try {
    const response = await createDeepSeekClient().chat.completions.create({
      model: modelName(),
      messages: [
        {
          role: "system",
          content: [
            "你是华美食品销售行动 Agent。把经营数据转成今天可执行的动作类型。",
            "最高约束：只呈现输入中明确存在的客观事实，不推断真因，不评价任何员工或客户，不虚构数字。",
            "每条行动必须引用 detectedFacts 中存在的 factId；不得改写事实、客户、分类或指标，只能自主决定优先级、动作类型和行动价值。",
            "按时间窗口、金额或客户影响排序。行动类型使用补货提醒、催单跟进、铺市跟进、回款跟进、客户唤醒等短语。",
            "必须只返回 JSON：{actions:Array<{factId:string,priority:'high'|'medium'|'low',actionType:string,rationale:string,confidence:number}>}。",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({ identity: snapshot.identity, asOf: snapshot.asOf, metrics: metricContext, detectedFacts }),
        },
      ],
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      max_tokens: 2200,
    });
    const normalized = normalizeActions(parseJson(response.choices[0]?.message?.content), key, detectedFacts);
    const value = {
      state: "ready",
      ...normalized,
      generatedAt: new Date().toISOString(),
      model: response.model,
      cached: false,
    };
    cache.set(key, { createdAt: Date.now(), value });
    return value;
  } catch (error) {
    return { state: "error", actions: [], generatedAt: null, ...classifyDeepSeekError(error) };
  }
}

export function selectMetrics(snapshot, catalog, requestedIds) {
  const allowed = new Map(catalog.map((metric) => [metric.id, metric]));
  return [...new Set(Array.isArray(requestedIds) ? requestedIds : [])]
    .slice(0, 12)
    .filter((id) => allowed.has(id) && snapshot.metrics[id] !== undefined)
    .map((id) => {
      const metric = allowed.get(id);
      return { id, name: metric.name, value: snapshot.metrics[id], unit: metric.unit, asOf: snapshot.asOf };
    });
}

export async function answerDataQuestion({ question, history = [], snapshot, catalog }) {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw Object.assign(new Error("DeepSeek Agent 未配置，请在服务端设置 DEEPSEEK_API_KEY"), { status: 503, expose: true });
  }
  const cleanQuestion = String(question || "").trim().slice(0, 2000);
  if (!cleanQuestion) throw Object.assign(new Error("问题不能为空"), { status: 400, expose: true });

  const client = createDeepSeekClient();
  const metricDirectory = catalog.map(({ id, name, unit, group }) => ({ id, name, unit, group }));
  const messages = [
    {
      role: "system",
      content: [
        "你是华美食品经营数据问答 Agent。回答当前登录身份权限范围内的数据问题。",
        "涉及数值时必须先调用 query_metrics，严禁凭记忆编造。只能使用工具返回的数据。",
        "只陈述事实和可验证的比较，不推断真因、不评价人。若目录没有所需指标，直接说明当前数据服务尚未提供该指标。",
        `当前身份：${snapshot.identity.roleName} ${snapshot.identity.name}，范围：${snapshot.identity.orgName}，数据截至：${snapshot.asOf}。`,
        `可查询指标目录：${JSON.stringify(metricDirectory)}`,
      ].join("\n"),
    },
    ...history.slice(-6).flatMap((item) => {
      if (!item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string") return [];
      return [{ role: item.role, content: item.content.slice(0, 2000) }];
    }),
    { role: "user", content: cleanQuestion },
  ];
  const tools = [{
    type: "function",
    function: {
      name: "query_metrics",
      description: "按指标 ID 查询当前身份权限范围内的最新只读经营数据。回答任何数值问题前必须调用。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          metricIds: { type: "array", items: { type: "string", enum: catalog.map((metric) => metric.id) } },
        },
        required: ["metricIds"],
      },
    },
  }];
  const usedMetricIds = new Set();

  try {
    for (let turn = 0; turn < 4; turn += 1) {
      const response = await client.chat.completions.create({
        model: modelName(),
        messages,
        tools,
        tool_choice: "auto",
        thinking: { type: "disabled" },
        max_tokens: 1400,
      });
      const message = response.choices[0]?.message;
      if (!message) throw new Error("模型没有返回消息");
      if (!message.tool_calls?.length) {
        return {
          answer: String(message.content || "当前没有可回答的数据。"),
          metricIds: [...usedMetricIds],
          generatedAt: new Date().toISOString(),
          model: response.model,
        };
      }

      messages.push({ role: "assistant", content: message.content, tool_calls: message.tool_calls });
      for (const toolCall of message.tool_calls) {
        let args = {};
        try { args = JSON.parse(toolCall.function.arguments || "{}"); } catch { args = {}; }
        const rows = toolCall.function.name === "query_metrics" ? selectMetrics(snapshot, catalog, args.metricIds) : [];
        rows.forEach((row) => usedMetricIds.add(row.id));
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ scope: snapshot.identity.orgName, rows, unavailable: rows.length === 0 }),
        });
      }
    }
    throw new Error("Agent 查询轮次超过限制");
  } catch (error) {
    const classified = classifyDeepSeekError(error);
    throw Object.assign(new Error(classified.summary), { status: 502, detail: classified.detail, expose: true });
  }
}
