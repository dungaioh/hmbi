import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const projectRoot = path.resolve(import.meta.dirname, "..");
const seedPath = path.join(projectRoot, "data", "cards.json");
const localPath = path.join(projectRoot, "data", "cards.local.json");
const catalogPath = path.join(projectRoot, "data", "metric-catalog.json");

let writeQueue = Promise.resolve();

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function getMetricCatalog() {
  return readJson(catalogPath);
}

export async function getCards() {
  try {
    return await readJson(localPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return readJson(seedPath);
  }
}

async function persistCards(cards) {
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  const tempPath = `${localPath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(cards, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, localPath);
}

function queuedWrite(operation) {
  const next = writeQueue.then(operation, operation);
  writeQueue = next.catch(() => undefined);
  return next;
}

function assertMetricIds(metricIds, catalog) {
  const validIds = new Set(catalog.map((metric) => metric.id));
  if (!Array.isArray(metricIds) || metricIds.length === 0) {
    throw Object.assign(new Error("至少选择一个指标"), { status: 400 });
  }
  const invalid = metricIds.filter((id) => !validIds.has(id));
  if (invalid.length) {
    throw Object.assign(new Error(`未知指标：${invalid.join(", ")}`), { status: 400 });
  }
}

export async function createCard(input) {
  return queuedWrite(async () => {
    const [cards, catalog] = await Promise.all([getCards(), getMetricCatalog()]);
    assertMetricIds(input.metricIds, catalog);
    const title = String(input.title ?? "").trim();
    if (!title) throw Object.assign(new Error("卡片名称不能为空"), { status: 400 });
    const allowedTypes = new Set(["sprint", "health", "kpi-grid", "trend"]);
    if (!allowedTypes.has(input.type)) {
      throw Object.assign(new Error("不支持的卡片类型"), { status: 400 });
    }
    const card = {
      id: randomUUID(),
      title,
      eyebrow: String(input.eyebrow || "自定义指标卡").slice(0, 48),
      type: input.type,
      metricIds: [...new Set(input.metricIds)],
      enabled: true,
      order: Math.max(0, ...cards.map((item) => Number(item.order) || 0)) + 10,
    };
    const nextCards = [...cards, card];
    await persistCards(nextCards);
    return card;
  });
}

export async function updateCardMetrics(id, input) {
  return queuedWrite(async () => {
    const [cards, catalog] = await Promise.all([getCards(), getMetricCatalog()]);
    const index = cards.findIndex((card) => card.id === id);
    if (index < 0) throw Object.assign(new Error("卡片不存在"), { status: 404 });
    const nextCard = { ...cards[index] };
    if (input.metricIds !== undefined) {
      assertMetricIds(input.metricIds, catalog);
      nextCard.metricIds = [...new Set(input.metricIds)];
    }
    if (input.enabled !== undefined) nextCard.enabled = Boolean(input.enabled);
    cards[index] = nextCard;
    await persistCards(cards);
    return nextCard;
  });
}
