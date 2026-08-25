import { Priority, Prisma, RequirementRule, SensorReading, WeatherReading } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";

type Trigger = { always?: boolean; sensor?: string; lt?: number; gt?: number; weather?: string; stage?: string };
type Context = { sensor: SensorReading | null; weather: WeatherReading | null; stageSlug: string };
const ranks: Record<Priority, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
const sensorValue = (sensor: SensorReading | null, key: string) => sensor ? (sensor as unknown as Record<string, unknown>)[key] as number | null : null;
const weatherValue = (weather: WeatherReading | null, key: string) => weather ? (weather as unknown as Record<string, unknown>)[key] as number | null : null;

export function matchesRule(rule: RequirementRule, context: Context) {
  const t = rule.trigger as Trigger;
  if (t.always) return true;
  if (t.stage && t.stage !== context.stageSlug) return false;
  const value = t.sensor ? sensorValue(context.sensor, t.sensor) : t.weather ? weatherValue(context.weather, t.weather) : null;
  if (value == null) return false;
  if (t.lt != null && value >= t.lt) return false;
  if (t.gt != null && value <= t.gt) return false;
  return true;
}

function priorityFor(rule: RequirementRule, sensor: SensorReading | null) {
  const t = rule.trigger as Trigger;
  const value = t.sensor ? sensorValue(sensor, t.sensor) : null;
  if (t.sensor === "soilMoisture" && value != null && value < 22) return Priority.CRITICAL;
  if (t.sensor === "dissolvedOxygen" && value != null && value < 3.5) return Priority.CRITICAL;
  return rule.basePriority;
}

export async function analyzeFarm(farmId: string, actorId: string) {
  const farm = await db.farm.findFirst({ where: { id: farmId, OR: [{ ownerId: actorId }, { members: { some: { userId: actorId } } }] },
    include: { crops: { where: { active: true }, include: { crop: true, stage: true } } } });
  if (!farm) throw new ApiError(404, "Farm not found or you do not have permission to access this farm.");
  const farmCrop = farm.crops[0];
  if (!farmCrop) throw new ApiError(400, "Add a crop or species before running analysis.");
  const [sensor, weather, rules, recentCompleted] = await Promise.all([
    db.sensorReading.findFirst({ where: { farmId }, orderBy: { observedAt: "desc" } }),
    db.weatherReading.findFirst({ where: { farmId }, orderBy: { observedAt: "desc" } }),
    db.requirementRule.findMany({ where: { cropId: farmCrop.cropId, active: true, OR: [{ stageId: farmCrop.stageId }, { stageId: null }] } }),
    db.activity.findMany({ where: { farmId, completedAt: { gte: new Date(Date.now() - 24 * 3600_000) } } })
  ]);
  const context = { sensor, weather, stageSlug: farmCrop.stage.slug };
  const matchingRules = rules.filter((rule) => matchesRule(rule, context) && !recentCompleted.some((activity) => activity.title.toLowerCase().includes(rule.title.toLowerCase())));
  const dateKey = new Date().toISOString().slice(0,10);
  const currentFingerprints = matchingRules.map((rule) => `${farmCrop.id}:${rule.id}:${dateKey}`);
  await db.requirement.updateMany({
    where: { farmId, status: "OPEN", ...(currentFingerprints.length ? { fingerprint: { notIn: currentFingerprints } } : {}) },
    data: { status: "DISMISSED" }
  });
  const generated = [];
  for (const rule of matchingRules) {
    const priority = priorityFor(rule, sensor);
    const reason = buildReason(rule, farm.name, farmCrop.crop.name, farmCrop.stage.name, sensor, weather);
    const fingerprint = `${farmCrop.id}:${rule.id}:${dateKey}`;
    const requirement = await db.requirement.upsert({
      where: { farmId_fingerprint_status: { farmId, fingerprint, status: "OPEN" } },
      update: { priority, reason, aiExplanation: reason },
      create: { farmId, farmCropId: farmCrop.id, type: rule.type, title: rule.title, priority, reason, timing: "Today / next suitable window", requiredService: rule.serviceCategory,
        riskLevel: priority.toLowerCase(), aiExplanation: reason, fingerprint, quantity: quantityFor(rule.type, farm.area), estimatedCost: costFor(rule.type, farm.area) }
    });
    generated.push(requirement);
    await db.recommendation.create({ data: { farmId, farmCropId: farmCrop.id, requirementId: requirement.id, summary: rule.title, action: rule.action, reason,
      safetyNote: rule.safetyNote, structured: { farmId, cropId: farmCrop.cropId, stage: farmCrop.stage.slug, priority, action: rule.action } } });
  }
  generated.sort((a,b) => ranks[b.priority] - ranks[a.priority]);
  const deductions = generated.reduce((n, r) => n + ({ CRITICAL: 18, HIGH: 10, MEDIUM: 5, LOW: 2 }[r.priority]), 0);
  const score = Math.max(20, Math.min(98, 94 - deductions));
  const riskLevel = score < 50 ? "critical" : score < 70 ? "high" : score < 85 ? "medium" : "low";
  await db.$transaction([
    db.farm.update({ where: { id: farmId }, data: { healthScore: score } }),
    db.farmHealthScore.create({ data: { farmId, score, riskLevel, factors: { openRequirements: generated.length, sensorId: sensor?.id, weatherId: weather?.id } } }),
    db.aiInteraction.create({ data: { userId: actorId, farmId, context: { farm: farm.name, crop: farmCrop.crop.name, stage: farmCrop.stage.name, sensor, weather },
      response: { farm_health: score, risk_level: riskLevel, requirements: generated.map(r => ({ id: r.id, farm_id: farmId, crop_id: farmCrop.cropId, type: r.type, priority: r.priority, reason: r.reason })) }, model: "deterministic-safety-engine-v1" } })
  ]);
  return { farmId, farmHealth: score, riskLevel, crop: farmCrop.crop.name, stage: farmCrop.stage.name, requirements: generated };
}

function buildReason(rule: RequirementRule, farm: string, crop: string, stage: string, sensor: SensorReading | null, weather: WeatherReading | null) {
  const t = rule.trigger as Trigger;
  const observed = t.sensor ? sensorValue(sensor, t.sensor) : t.weather ? weatherValue(weather, t.weather) : null;
  const signal = observed != null ? ` The latest ${t.sensor || t.weather} reading is ${observed}.` : "";
  const rain = weather && weather.rainProbability > 60 ? ` Rain probability is ${weather.rainProbability}%, so confirm conditions before irrigating.` : "";
  return `${farm}'s ${crop} is at the ${stage} stage. This farm-specific rule considers its area, stage, latest conditions and history.${signal}${rain}`;
}
const quantityFor = (type: string, area: number) => type === "labour" ? `${Math.ceil(area * 2)} workers` : type === "irrigation" ? `${Math.round(area * 45)} minutes estimated` : "Confirm after field inspection";
const costFor = (type: string, area: number) => Math.round((type === "machinery" ? 1800 : type === "labour" ? 700 : type === "irrigation" ? 450 : 600) * area);

export function safeStructuredResponse(value: unknown): value is Prisma.InputJsonValue {
  return value !== undefined && JSON.stringify(value).length < 100_000;
}
