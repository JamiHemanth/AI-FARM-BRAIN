import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Priority } from "@prisma/client";
import { db } from "@/lib/db";
import { analyzeFarm, matchesRule } from "@/lib/requirements";
import { DemoSensorProvider } from "@/lib/sensors";

let farmerId = "";
let cottonOwnerId = "";
let pondOwnerId = "";
let paddyId = "";
let cottonId = "";
let pondId = "";

beforeAll(async () => {
  const farmer = await db.user.findUniqueOrThrow({ where: { email: "farmer1@aifarmbrain.in" } });
  farmerId = farmer.id;
  const paddyFarm = await db.farm.findFirstOrThrow({ where: { ownerId: farmer.id, name: { contains: "Paddy" } } });
  const cottonFarmer = await db.user.findUniqueOrThrow({ where: { email: "farmer2@aifarmbrain.in" } });
  const pondFarmer = await db.user.findUniqueOrThrow({ where: { email: "farmer3@aifarmbrain.in" } });
  cottonOwnerId = cottonFarmer.id;
  pondOwnerId = pondFarmer.id;
  const cottonFarm = await db.farm.findFirstOrThrow({ where: { ownerId: cottonFarmer.id, name: { contains: "Cotton" } } });
  const pondFarm = await db.farm.findFirstOrThrow({ where: { ownerId: pondFarmer.id, type: "FISHERY" } });
  paddyId = paddyFarm.id;
  cottonId = cottonFarm.id;
  pondId = pondFarm.id;
});

afterAll(() => db.$disconnect());

describe("configurable requirement rules", () => {
  it("evaluates sensor thresholds without hardcoded frontend output", () => {
    const rule = { trigger: { sensor: "soilMoisture", lt: 38 } } as never;
    const context = { sensor: { soilMoisture: 28 } as never, weather: null, stageSlug: "tillering" };
    expect(matchesRule(rule, context)).toBe(true);
    expect(matchesRule(rule, { ...context, sensor: { soilMoisture: 52 } as never })).toBe(false);
  });

  it("generates scenario readings appropriate to farm type", async () => {
    const provider = new DemoSensorProvider();
    const dry = await provider.read("farm", "AGRICULTURE", "low-moisture");
    const pond = await provider.read("pond", "FISHERY", "normal");
    expect(dry.soilMoisture).toBeLessThan(30);
    expect(pond.soilMoisture).toBeNull();
    expect(pond.dissolvedOxygen).toBeGreaterThan(4);
  });
});

describe("strict farm and crop isolation", () => {
  it("returns different requirement families for paddy, cotton, and fishery", async () => {
    const [paddy, cotton, pond] = await Promise.all([
      analyzeFarm(paddyId, farmerId), analyzeFarm(cottonId, cottonOwnerId), analyzeFarm(pondId, pondOwnerId)
    ]);
    expect(paddy.crop).toBe("Paddy");
    expect(paddy.requirements.some((r) => r.title.includes("Irrigation"))).toBe(true);
    expect(cotton.crop).toBe("Cotton");
    expect(cotton.requirements.every((r) => !r.title.includes("Irrigation monitoring"))).toBe(true);
    expect(pond.crop).toBe("Tilapia");
    expect(pond.requirements.every((r) => r.type === "water-quality")).toBe(true);
  });

  it("raises farm-specific priority after a persisted critical reading", async () => {
    await db.sensorReading.create({ data: { farmId: pondId, scenario: "water-shortage", ph: 7.1, waterLevel: 17, airTemperature: 30, humidity: 72, dissolvedOxygen: 3.2 } });
    const analysis = await analyzeFarm(pondId, pondOwnerId);
    expect(analysis.requirements.some((r) => r.priority === Priority.CRITICAL && r.title.includes("oxygen"))).toBe(true);
  });

  it("rejects a database record that pairs one farm with another farm's crop", async () => {
    const cottonCrop = await db.farmCrop.findFirstOrThrow({ where: { farmId: cottonId, active: true } });
    await expect(db.requirement.create({ data: { farmId: paddyId, farmCropId: cottonCrop.id, type: "test", title: "Must fail", priority: "LOW", reason: "isolation test", timing: "never", riskLevel: "low", aiExplanation: "test", fingerprint: `invalid-${Date.now()}` } })).rejects.toThrow();
  });
});

describe("pilot farmer and transporter workflow", () => {
  it("has three separate pilot farmers with linked transporter and sector bookings", async () => {
    const farmers = await db.user.findMany({
      where: { email: { in: ["farmer1@aifarmbrain.in", "farmer2@aifarmbrain.in", "farmer3@aifarmbrain.in"] } },
      include: { farms: true }
    });
    expect(farmers).toHaveLength(3);
    expect(farmers.every((farmer) => farmer.farms.length >= 1)).toBe(true);

    const transporter = await db.serviceProvider.findFirstOrThrow({
      where: { user: { email: "transport@aifarmbrain.in" } },
      include: { services: { include: { service: true } }, bookings: true }
    });
    expect(transporter.verified).toBe(true);
    expect(transporter.services.some((item) => item.service.slug === "transport")).toBe(true);
    const openTransportRequests = await db.booking.findMany({ where: { providerId: null, status: "REQUESTED", service: { slug: "transport" } } });
    expect(openTransportRequests.length).toBeGreaterThanOrEqual(3);

    const sectorProviders = await db.serviceProvider.findMany({
      where: { user: { email: { in: ["fertilizer@aifarmbrain.in", "machinery@aifarmbrain.in", "inspection@aifarmbrain.in"] } } },
      include: { user: true, services: { include: { service: true } }, bookings: true }
    });
    expect(sectorProviders).toHaveLength(3);
    expect(sectorProviders.some((provider) => provider.services.some((item) => item.service.slug === "fertilizer-shop"))).toBe(true);
    expect(sectorProviders.some((provider) => provider.services.some((item) => item.service.slug === "tractor"))).toBe(true);
    expect(sectorProviders.some((provider) => provider.services.some((item) => item.service.slug === "crop-inspection"))).toBe(true);
  });

  it("keeps farmer requests open until the first matching provider accepts", async () => {
    const farm = await db.farm.findUniqueOrThrow({ where: { id: paddyId } });
    const farmCrop = await db.farmCrop.findFirstOrThrow({ where: { farmId: paddyId, active: true } });
    const service = await db.service.findUniqueOrThrow({ where: { slug: "fertilizer-shop" } });
    const inputShop = await db.serviceProvider.findFirstOrThrow({ where: { user: { email: "fertilizer@aifarmbrain.in" } } });
    const request = await db.booking.create({ data: { userId: farmerId, farmId: paddyId, farmCropId: farmCrop.id, serviceId: service.id, scheduledAt: new Date(Date.now() + 5 * 86400000), location: farm.location, estimatedPrice: service.basePrice, notes: `test-open-marketplace-${Date.now()}` } });
    const claimed = await db.booking.updateMany({ where: { id: request.id, providerId: null, status: "REQUESTED" }, data: { providerId: inputShop.id, status: "ACCEPTED" } });
    const secondClaim = await db.booking.updateMany({ where: { id: request.id, providerId: null, status: "REQUESTED" }, data: { providerId: inputShop.id, status: "ACCEPTED" } });
    expect(claimed.count).toBe(1);
    expect(secondClaim.count).toBe(0);
  });
});
