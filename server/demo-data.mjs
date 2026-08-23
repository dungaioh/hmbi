const roles = {
  "customer-manager": {
    id: "E10086",
    role: "customer-manager",
    roleName: "客户经理",
    name: "张伟",
    orgCode: "CN-EAST-SH",
    orgName: "华东 · 上海",
  },
  "regional-manager": {
    id: "E20018",
    role: "regional-manager",
    roleName: "大区经理",
    name: "陈敏",
    orgCode: "CN-EAST",
    orgName: "华东大区",
  },
  executive: {
    id: "E00001",
    role: "executive",
    roleName: "经营高层",
    name: "林总",
    orgCode: "CN",
    orgName: "全国",
  },
};

const roleData = {
  "customer-manager": {
    metrics: {
      seasonal_attainment: 62,
      seasonal_target: 280,
      seasonal_achieved: 173,
      seasonal_gap: 107,
      days_remaining: 9,
      daily_required: 12,
      active_customers: 6,
      total_customers: 8,
      distribution_rate: 75,
      new_distribution_rate: 37.5,
      sales_amount: 186.4,
      sales_yoy: 8.6,
      collection_rate: 91.4,
      inventory_turnover: 18.2,
    },
    trend: [118, 126, 121, 139, 151, 162, 186],
    anomalies: [
      { customer: "华润万家 · 中秋档", category: "季节达成", fact: "月饼订量 40 万元，仅达客户目标 40%，距中秋节点 9 天。", metricIds: ["seasonal_attainment", "days_remaining"] },
      { customer: "城市便利 · 浦东", category: "断货风险", fact: "面包类库存仅可支撑 2 天，低于 5 天安全线。", metricIds: ["inventory_turnover"] },
      { customer: "邻里生鲜 · 杨浦", category: "客户活跃", fact: "连续 3 周无下单，此前月均 4 单。", metricIds: ["active_customers"] },
      { customer: "优选超市 · 静安", category: "新品铺市", fact: "3 款重点新品应铺未铺；同区已有 5 家客户完成铺市。", metricIds: ["new_distribution_rate"] },
      { customer: "万家 · 闵行", category: "回款", fact: "应收逾期 15 天，金额 8.6 万元。", metricIds: ["collection_rate"] },
    ],
  },
  "regional-manager": {
    metrics: {
      seasonal_attainment: 71,
      seasonal_target: 2860,
      seasonal_achieved: 2031,
      seasonal_gap: 829,
      days_remaining: 9,
      daily_required: 92,
      active_customers: 84,
      total_customers: 103,
      distribution_rate: 81.6,
      new_distribution_rate: 58.3,
      sales_amount: 2396,
      sales_yoy: 12.4,
      collection_rate: 93.8,
      inventory_turnover: 16.7,
    },
    trend: [1680, 1772, 1849, 1912, 2068, 2205, 2396],
    anomalies: [
      { customer: "苏南责任区", category: "季节达成", fact: "季节品达成 56%，低于华东大区均值 15 个百分点，剩余 9 天。", metricIds: ["seasonal_attainment", "days_remaining"] },
      { customer: "上海便利渠道", category: "断货风险", fact: "12 家门店面包类库存低于 3 天安全线。", metricIds: ["inventory_turnover"] },
      { customer: "浙北责任区", category: "客户活跃", fact: "本周活跃客户 18 家，较四周均值少 5 家。", metricIds: ["active_customers"] },
      { customer: "华东重点客户", category: "回款", fact: "逾期应收合计 47.2 万元，其中 3 笔逾期超过 14 天。", metricIds: ["collection_rate"] },
    ],
  },
  executive: {
    metrics: {
      seasonal_attainment: 68,
      seasonal_target: 12600,
      seasonal_achieved: 8568,
      seasonal_gap: 4032,
      days_remaining: 9,
      daily_required: 448,
      active_customers: 426,
      total_customers: 528,
      distribution_rate: 80.7,
      new_distribution_rate: 61.9,
      sales_amount: 11842,
      sales_yoy: 9.8,
      collection_rate: 92.6,
      inventory_turnover: 17.4,
    },
    trend: [8650, 9010, 9390, 9840, 10360, 10990, 11842],
    anomalies: [
      { customer: "华南大区", category: "季节达成", fact: "季节品达成 59%，低于全国均值 9 个百分点，目标缺口 980 万元。", metricIds: ["seasonal_attainment", "seasonal_gap"] },
      { customer: "现代渠道", category: "断货风险", fact: "全国 38 家重点门店核心面包库存低于 3 天。", metricIds: ["inventory_turnover"] },
      { customer: "西区市场", category: "新品铺市", fact: "重点新品铺市率 48%，低于全国均值 13.9 个百分点。", metricIds: ["new_distribution_rate"] },
      { customer: "全国应收", category: "回款", fact: "逾期超过 14 天的应收合计 326 万元。", metricIds: ["collection_rate"] },
    ],
  },
};

export function getDemoIdentity(role = "customer-manager") {
  return roles[role] ?? roles["customer-manager"];
}

export function getDemoSnapshot(role = "customer-manager") {
  const selectedRole = roles[role] ? role : "customer-manager";
  const now = new Date();
  const metrics = roleData[selectedRole].metrics;
  return {
    identity: roles[selectedRole],
    ...roleData[selectedRole],
    metrics,
    trendLabels: ["2月", "3月", "4月", "5月", "6月", "7月", "8月"],
    categoryMix: [
      { name: "日消烘焙", value: 58, share: 58 },
      { name: "季节礼品", value: 29, share: 29 },
      { name: "其他品类", value: 13, share: 13 },
    ],
    availableMetricIds: Object.keys(metrics),
    unavailableMetricIds: [],
    period: "2026-08",
    asOf: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 0).toISOString(),
  };
}

export const allowedRoles = Object.keys(roles);
