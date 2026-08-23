import { useCallback, useEffect, useRef, useState } from "react";
import type { EChartsCoreOption, EChartsType } from "echarts/core";
import {
  Activity,
  ArrowRight,
  Bot,
  ChevronDown,
  CircleAlert,
  Clock3,
  Database,
  Gauge,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  MessageCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Store,
  Target,
  TrendingUp,
  Users,
  WandSparkles,
  X,
} from "lucide-react";
import { apiFetch } from "./api";
import type { AgentAction, BoardResponse, CardConfig, MetricDefinition, Role } from "./types";

type View = "actions" | "overview";

const roleOptions: { id: Role; label: string; detail: string }[] = [
  { id: "customer-manager", label: "客户经理", detail: "张伟 · 华东上海" },
  { id: "regional-manager", label: "大区经理", detail: "陈敏 · 华东大区" },
  { id: "executive", label: "经营高层", detail: "林总 · 全国" },
];

function formatMetric(value: number | string | undefined, metric?: MetricDefinition) {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "string") return value;
  if (metric?.format === "integer") return Math.round(value).toLocaleString("zh-CN");
  if (metric?.format === "percent") return `${value.toFixed(value % 1 ? 1 : 0)}%`;
  if (metric?.format === "signedPercent") return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}

function shortDate(value?: string | null) {
  if (!value) return "未生成";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function useBoard(role: Role) {
  const [data, setData] = useState<BoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (forceAgent = false) => {
    setLoading(true);
    setError(null);
    try {
      const path = forceAgent ? "/api/agent/refresh" : "/api/board";
      const result = await apiFetch<BoardResponse>(`${path}?role=${role}`, { method: forceAgent ? "POST" : "GET" });
      setData(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    void load(false);
  }, [load]);

  return { data, loading, error, load, setData };
}

function BrandMark() {
  return <div className="brand-mark">华</div>;
}

function SideNav({ view, onView }: { view: View; onView: (view: View) => void }) {
  const items = [
    { id: "actions" as const, label: "今日行动", icon: Sparkles },
    { id: "overview" as const, label: "经营全景", icon: LayoutDashboard },
  ];
  return (
    <aside className="sidebar">
      <div className="side-brand"><BrandMark /><div><strong>销售行动 BI</strong><span>HM AI Native</span></div></div>
      <nav>
        {items.map((item) => {
          const Icon = item.icon;
          return <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => onView(item.id)}><Icon size={18} /><span>{item.label}</span></button>;
        })}
      </nav>
      <div className="side-foot"><ShieldCheck size={16} /><span>只读数据通道<br /><small>权限随身份下推</small></span></div>
    </aside>
  );
}

function MobileNav({ view, onView }: { view: View; onView: (view: View) => void }) {
  const items = [
    { id: "actions" as const, label: "行动", icon: Sparkles },
    { id: "overview" as const, label: "经营", icon: LayoutDashboard },
  ];
  return <nav className="mobile-nav">{items.map((item) => { const Icon = item.icon; return <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => onView(item.id)}><Icon size={20} /><span>{item.label}</span></button>; })}</nav>;
}

function RoleSwitcher({ role, onRole }: { role: Role; onRole: (role: Role) => void }) {
  return (
    <label className="role-switcher">
      <span className="role-avatar">{roleOptions.findIndex((item) => item.id === role) + 1}</span>
      <span className="role-copy"><small>模拟身份</small><strong>{roleOptions.find((item) => item.id === role)?.detail}</strong></span>
      <select value={role} onChange={(event) => onRole(event.target.value as Role)} aria-label="切换模拟身份">
        {roleOptions.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.detail}</option>)}
      </select>
      <ChevronDown size={15} />
    </label>
  );
}

function AppHeader({ role, onRole, data }: { role: Role; onRole: (role: Role) => void; data: BoardResponse | null }) {
  return (
    <header className="topbar">
      <div className="mobile-brand"><BrandMark /><div><strong>销售行动 BI</strong><span>从事实，到行动</span></div></div>
      <div className="topbar-spacer" />
      {data && <div className={`source-chip ${data.source.mode}`} title={data.source.detail}><span />{data.source.mode === "live" ? "实时数据 API" : "Demo 视图"}</div>}
      <RoleSwitcher role={role} onRole={onRole} />
      <button className="icon-button desktop-only" aria-label="退出模拟身份"><LogOut size={17} /></button>
    </header>
  );
}

function SectionHeading({ kicker, title, action }: { kicker: string; title: string; action?: React.ReactNode }) {
  return <div className="section-heading"><div><span>{kicker}</span><h2>{title}</h2></div>{action}</div>;
}

function SprintCard({ card, board }: { card: CardConfig; board: BoardResponse }) {
  const m = board.metrics;
  const attainment = Number(m.seasonal_attainment || 0);
  return (
    <article className="bi-card sprint-card">
      <div className="card-kicker"><Target size={15} />{card.eyebrow}</div>
      <div className="sprint-head"><div><h3>{card.title}</h3><p>距关键销售节点 <strong>{m.days_remaining ?? "—"}</strong> 天</p></div><div className="target-ring"><span>{Math.round(attainment)}%</span></div></div>
      <div className="sprint-progress"><span style={{ width: `${Math.min(attainment, 100)}%` }} /></div>
      <div className="sprint-stats">
        <div><small>目标</small><strong>{formatMetric(m.seasonal_target)}<i>万</i></strong></div>
        <div><small>已达</small><strong>{formatMetric(m.seasonal_achieved)}<i>万</i></strong></div>
        <div className="accent"><small>缺口</small><strong>{formatMetric(m.seasonal_gap)}<i>万</i></strong></div>
        <div className="accent"><small>需日均</small><strong>{formatMetric(m.daily_required)}<i>万</i></strong></div>
      </div>
    </article>
  );
}

function HealthCard({ card, board }: { card: CardConfig; board: BoardResponse }) {
  const active = Number(board.metrics.active_customers || 0);
  const total = Number(board.metrics.total_customers || 0);
  const stats = [
    { label: "活跃客户", value: active, suffix: `/${total}`, icon: Users, tone: "purple" },
    { label: "铺市率", value: Number(board.metrics.distribution_rate || 0), suffix: "%", icon: Store, tone: "orange" },
    { label: "新品铺市", value: Number(board.metrics.new_distribution_rate || 0), suffix: "%", icon: TrendingUp, tone: "pink" },
  ];
  return <article className="bi-card health-card"><div className="card-kicker purple"><Activity size={15} />{card.eyebrow}</div><div className="health-title"><div><h3>{card.title}</h3><p>客户活跃与终端覆盖健康度</p></div><span className="positive-pill">环比上升</span></div><div className="health-grid">{stats.map(({ label, value, suffix, icon: Icon, tone }) => <div className="health-stat" key={label}><span className={`stat-icon ${tone}`}><Icon size={17} /></span><div><strong>{Number.isInteger(value) ? value : value.toFixed(1)}<i>{suffix}</i></strong><small>{label}</small></div></div>)}</div></article>;
}

function KpiGridCard({ card, board }: { card: CardConfig; board: BoardResponse }) {
  const catalogMap = new Map(board.catalog.map((metric) => [metric.id, metric]));
  return <article className="bi-card kpi-card"><div className="card-kicker purple"><Gauge size={15} />{card.eyebrow}</div><div className="kpi-grid">{card.metricIds.map((id) => { const metric = catalogMap.get(id); const value = board.metrics[id]; return <div className="kpi-item" key={id}><small>{metric?.name ?? id}</small><strong className={id.includes("yoy") && Number(value) >= 0 ? "positive" : ""}>{formatMetric(value, metric)}<i>{metric?.format.includes("Percent") || metric?.format === "percent" ? "" : metric?.unit}</i></strong><span>{metric?.view}</span></div>; })}</div></article>;
}

function TrendCard({ card, board }: { card: CardConfig; board: BoardResponse }) {
  return <article className="bi-card chart-card"><div className="card-kicker purple"><TrendingUp size={15} />{card.eyebrow}</div><h3>{card.title}</h3><TrendChart values={board.trend} compact /></article>;
}

function ConfiguredCard({ card, board }: { card: CardConfig; board: BoardResponse }) {
  if (card.type === "sprint") return <SprintCard card={card} board={board} />;
  if (card.type === "health") return <HealthCard card={card} board={board} />;
  if (card.type === "trend") return <TrendCard card={card} board={board} />;
  return <KpiGridCard card={card} board={board} />;
}

function ActionCard({ action, index }: { action: AgentAction; index: number }) {
  const priorityLabel = { high: "优先", medium: "关注", low: "跟进" }[action.priority];
  return (
    <article className={`action-card priority-${action.priority}`}>
      <div className="action-number">{String(index + 1).padStart(2, "0")}</div>
      <div className="action-body">
        <div className="action-top"><div><span className="customer">{action.customer}</span><span className="category">{action.category}</span></div><span className="priority-label">{priorityLabel}</span></div>
        <p className="fact">{action.fact}</p>
        <div className="suggestion"><WandSparkles size={15} /><span><small>Agent 建议动作</small><strong>{action.actionType}</strong></span><ArrowRight size={16} /></div>
        <p className="why">{action.rationale}</p>
      </div>
    </article>
  );
}

function AgentSection({ board, refreshing, onRefresh }: { board: BoardResponse; refreshing: boolean; onRefresh: () => void }) {
  const ready = board.agent.state === "ready";
  return (
    <section className="agent-section">
      <SectionHeading kicker="AUTONOMOUS AGENT" title="今日行动建议" action={<button className="secondary-button" disabled={refreshing} onClick={onRefresh}>{refreshing ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}重新分析</button>} />
      <div className="agent-status-card">
        <div className={`agent-orb ${ready ? "ready" : "warning"}`}><Bot size={20} /></div>
        <div><strong>{ready ? board.agent.summary : board.agent.state === "error" ? "Agent 暂时不可用" : "等待 Agent 配置"}</strong><p>{ready ? `基于 ${board.agent.actions.length} 条高价值事实自主排序 · ${shortDate(board.agent.generatedAt)}` : board.agent.summary}</p></div>
        {ready && <span className="agent-model">{board.agent.cached ? "智能缓存" : "刚刚生成"}</span>}
      </div>
      {ready ? <div className="action-list">{board.agent.actions.map((action, index) => <ActionCard key={action.id} action={action} index={index} />)}</div> : <div className="empty-actions"><CircleAlert size={22} /><div><strong>没有用静态规则冒充 AI 建议</strong><p>{board.agent.detail || "确认服务端 DeepSeek 配置后点击重新分析。"}</p></div></div>}
      <div className="ai-constitution"><ShieldCheck size={16} /><span>AI 仅呈现数据事实与建议动作类型，不下真因结论、不评价人；具体判断由销售负责人决定。</span></div>
    </section>
  );
}

function LoadingScreen() {
  return <div className="loading-screen"><div className="loader-mark"><BrandMark /><span /></div><strong>正在汇总经营事实</strong><p>同步指标并请求行动 Agent…</p></div>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="error-state"><CircleAlert size={28} /><h2>行动屏暂时没有加载成功</h2><p>{message}</p><button className="primary-button" onClick={onRetry}><RefreshCw size={16} />重试</button></div>;
}

function ActionDashboard({ board, refreshing, onRefreshAgent }: { board: BoardResponse; refreshing: boolean; onRefreshAgent: () => void }) {
  const primaryCards = board.cards.filter((card) => card.id !== "sales-overview");
  return <><div className="page-intro"><div><span className="date-line"><Clock3 size={14} />{new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(new Date())}</span><h1>早上好，{board.identity.name}</h1><p>先处理最影响目标的事。数据截至 {shortDate(board.asOf)}。</p></div><div className="hero-score"><span>今日经营信号</span><strong>{board.agent.actions.length || "—"}</strong><small>项待关注</small></div></div><section><SectionHeading kicker="ACTION METRICS" title="目标与健康度" /><div className="metric-layout">{primaryCards.map((card) => <ConfiguredCard key={card.id} card={card} board={board} />)}</div></section><AgentSection board={board} refreshing={refreshing} onRefresh={onRefreshAgent} /></>;
}

function TrendChart({ values, compact = false }: { values: number[]; compact?: boolean }) {
  const safeValues = values.length ? values : [0, 0, 0, 0, 0, 0, 0];
  const option: EChartsCoreOption = {
    animationDuration: 800,
    grid: { left: compact ? 2 : 18, right: compact ? 2 : 12, top: 24, bottom: compact ? 0 : 28, containLabel: !compact },
    tooltip: { trigger: "axis", backgroundColor: "#2a1846", borderWidth: 0, textStyle: { color: "#fff" } },
    xAxis: { type: "category", boundaryGap: false, data: ["2月", "3月", "4月", "5月", "6月", "7月", "8月"], axisLine: { lineStyle: { color: "#e8e1f2" } }, axisLabel: { show: !compact, color: "#8b7c9f" }, axisTick: { show: false } },
    yAxis: { type: "value", show: !compact, splitLine: { lineStyle: { color: "#f0ebf6" } }, axisLabel: { color: "#8b7c9f" } },
    series: [{ type: "line", data: safeValues, smooth: 0.35, symbol: "circle", symbolSize: compact ? 5 : 7, lineStyle: { width: 3, color: "#ff6c00" }, itemStyle: { color: "#ff6c00", borderColor: "#fff", borderWidth: 2 }, areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(255,108,0,.25)" }, { offset: 1, color: "rgba(255,108,0,0)" }] } } }],
  };
  return <EChart option={option} height={compact ? 160 : 300} />;
}

function EChart({ option, height }: { option: EChartsCoreOption; height: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const optionRef = useRef(option);
  optionRef.current = option;

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    let observer: ResizeObserver | null = null;
    Promise.all([
      import("echarts/core"),
      import("echarts/charts"),
      import("echarts/components"),
      import("echarts/renderers"),
    ]).then(([core, charts, components, renderers]) => {
      if (disposed || !containerRef.current) return;
      core.use([charts.LineChart, components.GridComponent, components.TooltipComponent, renderers.CanvasRenderer]);
      const chart = core.init(containerRef.current, undefined, { renderer: "canvas" });
      chart.setOption(optionRef.current);
      chartRef.current = chart;
      observer = new ResizeObserver(() => chart.resize());
      observer.observe(containerRef.current);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={containerRef} style={{ width: "100%", height }} />;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  metricIds?: string[];
}

interface ChatAnswer {
  answer: string;
  metricIds: string[];
  generatedAt: string;
  model: string;
}

function ChatBI({ board, open, onClose }: { board: BoardResponse; open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([{
    role: "assistant",
    content: `你好，${board.identity.name}。我可以查询 ${board.identity.orgName} 权限范围内的经营指标。你想了解什么？`,
  }]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const quickQuestions = ["季节品目标缺口还有多大？", "回款与库存周转情况如何？", "客户活跃和新品铺市表现怎样？"];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function ask(question: string) {
    const clean = question.trim();
    if (!clean || sending) return;
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, { role: "user", content: clean }]);
    setInput("");
    setSending(true);
    try {
      const result = await apiFetch<ChatAnswer>(`/api/chat?role=${board.identity.role}`, {
        method: "POST",
        body: JSON.stringify({ question: clean, history }),
      });
      setMessages((current) => [...current, { role: "assistant", content: result.answer, metricIds: result.metricIds }]);
    } catch (caught) {
      setMessages((current) => [...current, { role: "assistant", content: caught instanceof Error ? caught.message : "问数服务暂时不可用。" }]);
    } finally {
      setSending(false);
    }
  }

  return <><div className={`chat-backdrop ${open ? "open" : ""}`} onClick={onClose} /><aside className={`chat-panel ${open ? "open" : ""}`} aria-hidden={!open}><header><div className="chat-agent-mark"><Bot size={20} /></div><div><strong>经营问数 Agent</strong><span>DeepSeek V4 Flash · 只读数据</span></div><button className="icon-button" onClick={onClose} aria-label="关闭问数"><X size={18} /></button></header><div className="chat-scope"><Database size={14} /><span>当前数据范围：{board.identity.orgName}</span><small>截至 {shortDate(board.asOf)}</small></div><div className="chat-messages" ref={scrollRef}>{messages.map((message, index) => <div className={`chat-message ${message.role}`} key={`${message.role}-${index}`}><div>{message.content}</div>{message.metricIds?.length ? <p>已查询 {message.metricIds.map((id) => board.catalog.find((metric) => metric.id === id)?.name || id).join("、")}</p> : null}</div>)}{sending && <div className="chat-message assistant thinking"><LoaderCircle className="spin" size={15} />正在选择指标并查询…</div>}{messages.length === 1 && <div className="quick-questions">{quickQuestions.map((question) => <button key={question} onClick={() => void ask(question)}>{question}</button>)}</div>}</div><form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void ask(input); }}><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="询问现有卡片之外的经营数据…" rows={2} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(input); } }} /><button disabled={sending || !input.trim()} aria-label="发送问题"><Send size={17} /></button><small>Agent 只查询当前身份可见的只读指标，不推断业务真因。</small></form></aside></>;
}

function OverviewDashboard({ board }: { board: BoardResponse }) {
  const [chatOpen, setChatOpen] = useState(false);
  const overview = board.cards.find((card) => card.id === "sales-overview");
  const catalogMap = new Map(board.catalog.map((item) => [item.id, item]));
  const kpis = overview?.metricIds ?? ["sales_amount", "sales_yoy", "collection_rate", "inventory_turnover"];
  return <><div className="page-intro compact"><div><span className="date-line"><LayoutDashboard size={14} />经营全景</span><h1>{board.identity.orgName}</h1><p>描述性指标放在二屏；需要更多数据时，直接向问数 Agent 提问。</p></div><button className="chatbi-launch" onClick={() => setChatOpen(true)}><span><MessageCircle size={19} /></span><div><small>CHAT WITH DATA</small><strong>向 Agent 问数</strong></div><ArrowRight size={16} /></button></div><div className="overview-kpis">{kpis.map((id) => { const metric = catalogMap.get(id); return <article key={id}><span>{metric?.name}</span><strong>{formatMetric(board.metrics[id], metric)}<i>{metric?.format.includes("Percent") || metric?.format === "percent" ? "" : metric?.unit}</i></strong><small><TrendingUp size={13} />数据截至 T-1</small></article>; })}</div><div className="overview-grid"><article className="bi-card wide-chart"><div className="chart-head"><div><span>近 7 个月</span><h2>销售出库趋势</h2></div><span className="positive-pill">同比 +{board.metrics.sales_yoy}%</span></div><TrendChart values={board.trend} /></article><article className="bi-card structure-card"><div className="chart-head"><div><span>品类贡献</span><h2>结构概览</h2></div></div><div className="donut"><div><strong>58%</strong><span>日消品</span></div></div><ul><li><span className="orange" />日消烘焙 <strong>58%</strong></li><li><span className="purple" />季节礼品 <strong>29%</strong></li><li><span className="pink" />其他品类 <strong>13%</strong></li></ul></article></div><ChatBI key={board.identity.id} board={board} open={chatOpen} onClose={() => setChatOpen(false)} /></>;
}

export default function App() {
  const [view, setView] = useState<View>("actions");
  const [role, setRole] = useState<Role>("customer-manager");
  const { data, loading, error, load } = useBoard(role);
  const [refreshingAgent, setRefreshingAgent] = useState(false);

  async function refreshAgent() { setRefreshingAgent(true); await load(true); setRefreshingAgent(false); }

  return <div className="app-shell"><SideNav view={view} onView={setView} /><div className="app-column"><AppHeader role={role} onRole={setRole} data={data} /><main className="content">{loading && !data ? <LoadingScreen /> : error && !data ? <ErrorState message={error} onRetry={() => void load(false)} /> : data ? view === "actions" ? <ActionDashboard board={data} refreshing={refreshingAgent} onRefreshAgent={() => void refreshAgent()} /> : <OverviewDashboard board={data} /> : null}</main></div><MobileNav view={view} onView={setView} /></div>;
}
