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

适配器按照《EKP 数据开放 API｜中文接入文档》接入固定只读资源：

- `GET /open-api/v1/sales-deliveries`
- `GET /open-api/v1/customer-employees`
- `GET /open-api/v1/sales-targets`

所有请求通过服务端 `X-API-Key` 认证，使用 `page`、`size` 和文档列出的 lowerCamelCase 查询参数；不会发送 SQL、表名或任意字段表达式。复制配置模板后，在 `.env.local` 填写：

```dotenv
DATA_API_BASE_URL=http://183.63.194.18:8098
DATA_API_PREFIX=/open-api/v1
DATA_API_TOKEN=ekp_<clientCode>.<secret>
DATA_API_MODE=live
DATA_API_EMPLOYEE_CODE=E001
DATA_API_MAX_RETRIES=1
DATA_API_RETRY_BASE_MS=60000
DATA_API_CACHE_TTL_MS=60000
DATA_API_DELIVERY_CONCURRENCY=1

# 用于验证有历史数据的月份；留空表示当前月份
DATA_API_PERIOD=2026-08

# 必须按 /v3/api-docs 中销售出库的实际金额字段填写
DATA_API_SALES_AMOUNT_FIELD=amount
DATA_API_AMOUNT_DIVISOR=10000

# 季节品业务口径
DATA_API_SEASONAL_PRODUCT_LINE=月饼
DATA_API_SEASONAL_CATEGORY=
DATA_API_SEASONAL_DEADLINE=2026-08-31

# 可选；配置后才计算新品客户覆盖率
DATA_API_NEW_PRODUCT_MATCH=新品
```

`DATA_API_EMPLOYEE_CODE` 必须是 EKP 中存在的真实员工工号。适配器先从 `customer-employees` 读取该员工的责任客户，再用文档支持的 `customerCode` 逐户查询 `sales-deliveries`，避免无效的员工字段过滤退化为全量查询。

为避免 `API_RATE_LIMIT_EXCEEDED`，EKP 请求默认串行执行。文档要求 429 后延迟到下一分钟再试，因此默认等待 60 秒后重试 1 次；若响应带 `Retry-After` 则优先采用该值。看板、Agent 和 ChatBI 在 60 秒内复用同一份 live 快照，同时发起的相同请求也会合并。若 API Key 仍由其他服务共用并触发限流，可适当提高 `DATA_API_CACHE_TTL_MS`；不建议提高 `DATA_API_DELIVERY_CONCURRENCY`。

销售出库普通分页只支持字段精确匹配，没有文档化的日期范围条件。它适合小结果集和抽样，不适合在页面请求中深分页拉取大客户历史数据；正式 BI 应先通过 `/sales-deliveries/changes` 增量同步到持久化数据层，再在本地按月份聚合。

金额字段必须以 OpenAPI JSON 为准：

```bash
curl -sS http://183.63.194.18:8098/v3/api-docs -o ekp-openapi.json
```

适配器读取统一响应外壳中的 `data.rows`，自动普通分页，并在金额汇总时按 decimal 两位小数累加。季节品目标来自 `sales-targets.targetAmount`；已达、出库额、同比、趋势和品类结构来自 `sales-deliveries`；责任客户来自 `customer-employees`。EKP 当前未开放回款和库存数据，因此 live 模式不会伪造回款率或库存周转天数，对应卡片显示 `—`。

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

验证真实数据库链路时先启动服务：

```bash
npm start
```

另开一个终端，先测试 Data API，不触发 DeepSeek：

```bash
curl -sS http://127.0.0.1:8787/api/health
curl -sS 'http://127.0.0.1:8787/api/data-probe?role=customer-manager'
```

`data-probe` 最多请求三个资源的第一页，不会深分页，也不会调用 DeepSeek。重点检查：

- `resources.salesDeliveries.fields`：真实出库字段；
- `diagnostics.customerFilterMatches`：应为 `true`；
- `diagnostics.billDateDescending`：应为 `true`；
- `diagnostics.availableAmountFields`：把返回字段写入 `DATA_API_SALES_AMOUNT_FIELD`；
- `diagnostics.deliveryExceedsBoardPageLimit`：若为 `true`，证明普通分页不适合直接驱动完整 BI。

也可以指定一个已知客户，只读取该客户的 5 行样本：

```bash
curl -sS 'http://127.0.0.1:8787/api/data-probe?role=customer-manager&customerCode=C001'
```

只有确认结果总量可控后，再测试完整聚合：

```bash
curl -sS 'http://127.0.0.1:8787/api/data-check?role=customer-manager'
```

`data-check` 成功标准：返回 `"ok":true`、`source.mode` 为 `live`、`rowCounts` 至少一类大于 0，`source.diagnostics.deliveryScope` 为 `customerCode`。确认完整数据后测试 Agent：

```bash
curl -sS -X POST 'http://127.0.0.1:8787/api/agent/refresh?role=customer-manager'
```

返回中的 `agent.state` 为 `ready` 且 `agent.actions` 非空，表示 DeepSeek 已基于本次 EKP 聚合指标和检测事实生成建议。若数据链路成功但金额类指标为 `—`，请按 `/v3/api-docs` 修正 `DATA_API_SALES_AMOUNT_FIELD`。
