function pendingAgent() {
  return {
    state: "pending",
    summary: "经营指标已就绪，行动 Agent 正在分析。",
    actions: [],
    generatedAt: null,
  };
}

export async function composeBoard(role, { includeAgent = false, forceAgent = false } = {}, dependencies) {
  const {
    getCards,
    getMetricCatalog,
    getDemoIdentity,
    getBoardData,
    generateActions,
  } = dependencies;
  const [cards, catalog] = await Promise.all([getCards(), getMetricCatalog()]);
  const identity = getDemoIdentity(role);
  const { snapshot, source } = await getBoardData({ role, identity, catalog });
  const agent = includeAgent
    ? await generateActions(snapshot, catalog, { force: forceAgent })
    : pendingAgent();
  return {
    identity: snapshot.identity,
    period: snapshot.period,
    asOf: snapshot.asOf,
    source,
    metrics: snapshot.metrics,
    trend: snapshot.trend,
    trendLabels: snapshot.trendLabels,
    categoryMix: snapshot.categoryMix,
    cards: cards.filter((card) => card.enabled).sort((a, b) => a.order - b.order),
    catalog,
    agent,
  };
}
