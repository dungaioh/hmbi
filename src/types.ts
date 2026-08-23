export type Role = "customer-manager" | "regional-manager" | "executive";
export type CardType = "sprint" | "health" | "kpi-grid" | "trend";

export interface Identity {
  id: string;
  role: Role;
  roleName: string;
  name: string;
  orgCode: string;
  orgName: string;
}

export interface MetricDefinition {
  id: string;
  name: string;
  unit: string;
  group: string;
  view: string;
  field: string;
  format: "percent" | "number" | "integer" | "signedPercent";
}

export interface CardConfig {
  id: string;
  title: string;
  eyebrow: string;
  type: CardType;
  metricIds: string[];
  enabled: boolean;
  order: number;
}

export interface AgentAction {
  id: string;
  priority: "high" | "medium" | "low";
  customer: string;
  category: string;
  fact: string;
  actionType: string;
  rationale: string;
  metricIds: string[];
  confidence: number;
}

export interface BoardResponse {
  identity: Identity;
  period: string;
  asOf: string;
  source: {
    mode: "live" | "demo";
    state: "ready" | "fallback";
    message: string;
    detail?: string;
    diagnostics?: {
      rowCounts: {
        salesDeliveries: number;
        customerEmployees: number;
        salesTargets: number;
      };
      amountField: string | null;
    };
  };
  metrics: Record<string, number | string>;
  trend: number[];
  trendLabels?: string[];
  categoryMix?: Array<{ name: string; value: number; share: number }>;
  cards: CardConfig[];
  catalog: MetricDefinition[];
  agent: {
    state: "ready" | "error" | "unavailable";
    summary: string;
    actions: AgentAction[];
    generatedAt: string | null;
    model?: string;
    cached?: boolean;
    errorCode?: string;
    detail?: string;
  };
}
