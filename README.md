# 华美销售行动 BI

移动优先的销售经营 POC：把季节品冲刺、日消品健康、经营全景和 Agent 行动建议统一为可配置卡片容器。

## 已实现

- 行动第一屏：目标达成、目标缺口、节点倒计时、需日均、活跃客户、铺市率。
- 经营全景：出库额、同比、回款率、库存周转和趋势/结构图，并提供可展开的 ChatBI 问数面板。
- 三档模拟身份：客户经理、大区经理、经营高层；服务端把身份映射传给数据 API。
- 用户端没有卡片管理 UI；所有 `/api/admin/*` 接口必须使用独立 `ADMIN_API_TOKEN`，普通业务身份不能修改卡片。
- 自主 Agent：服务端通过 DeepSeek V4 Flash 生成行动卡，并通过受限的 `query_metrics` 工具回答卡片以外的经营问题。
- 安全边界：DeepSeek Key、管理员令牌与数据 API Token 只在 Node 服务端；数据适配器只发读请求，不接受 SQL。

## 启动

```bash
npm install
npm run dev
```

前端默认运行在 `http://127.0.0.1:5173`，Node API 在 `http://127.0.0.1:8787`。

生产构建：

```bash
npm run build
npm start
```

## 数据 API 对接

默认连接 `http://183.63.194.18:8098`，以 `POST /open-api/query` 查询只读视图。可在 `.env.local` 调整：

```dotenv
DATA_API_BASE_URL=http://183.63.194.18:8098
DATA_API_QUERY_PATH=/open-api/query
DATA_API_TOKEN=
DATA_API_MODE=auto
```

请求契约：

```json
{
  "view": "demo_seasonal_sprint",
  "fields": ["attainment_rate", "target_amount"],
  "filters": {
    "employeeId": "E10086",
    "role": "customer-manager",
    "orgCode": "CN-EAST-SH"
  },
  "limit": 200,
  "readOnly": true
}
```

适配器兼容数组及常见的 `data`、`rows`、`records`、`result.records` 返回包裹。指标与视图字段映射位于 `data/metric-catalog.json`。由于当前执行网络无法访问所给 OpenAPI 文档，`DATA_API_QUERY_PATH` 和真实视图/字段需要在能访问该服务的网络中按文档校准。

`DATA_API_MODE`：

- `auto`：优先真实接口，失败时显示明确标记的 demo 数据。
- `live`：真实接口失败即报错，不回退。
- `demo`：仅使用内置的三身份演示视图。

## Agent 约束

Agent 只生成“客观事实 + 建议动作类型 + 行动价值”，禁止推断真因或评价人员。接口实现位于 `server/agent.mjs`，使用 DeepSeek 官方 OpenAI 兼容端点与 `deepseek-v4-flash`。DeepSeek 官方文档确认该模型支持 JSON 输出和 Tool Calls：[模型说明](https://api-docs.deepseek.com/quick_start/pricing)、[Tool Calls](https://api-docs.deepseek.com/guides/tool_calls)。

```dotenv
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
```

ChatBI 不允许模型构造 SQL 或任意视图名；模型只能从 `data/metric-catalog.json` 中选择指标 ID，服务端再按当前身份范围查询/返回数据。

## 管理员卡片配置

应用不提供卡片管理页面。管理员可直接维护 `data/cards.json`，或在服务端设置独立令牌后调用受保护的管理 API：

```dotenv
ADMIN_API_TOKEN=请使用高强度随机值
```

- `GET /api/admin/cards`
- `GET /api/admin/catalog`
- `POST /api/admin/cards`
- `PATCH /api/admin/cards/:id`

所有请求都必须携带 `Authorization: Bearer <ADMIN_API_TOKEN>`。业务用户的身份切换不会授予管理员权限。

## 验证

```bash
npm test
npm run build
```
