import { PrismaClient, FarmType, Priority, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { analyzeFarm } from "../lib/requirements";

const db = new PrismaClient();

const cropDefinitions = [
  { slug: "paddy", name: "Paddy", type: FarmType.AGRICULTURE, varieties: ["BPT 5204", "MTU 1010"], stages: ["Nursery", "Transplanting", "Vegetative", "Tillering", "Panicle initiation", "Flowering", "Grain filling", "Harvest"] },
  { slug: "cotton", name: "Cotton", type: FarmType.AGRICULTURE, varieties: ["Bt Cotton", "Desi Cotton"], stages: ["Germination", "Vegetative", "Squaring", "Flowering", "Boll development", "Maturity", "Harvest"] },
  { slug: "maize", name: "Maize", type: FarmType.AGRICULTURE, varieties: ["Hybrid", "Sweet corn"], stages: ["Germination", "Vegetative", "Tasseling", "Silking", "Grain filling", "Maturity", "Harvest"] },
  { slug: "chilli", name: "Chilli", type: FarmType.AGRICULTURE, varieties: ["Teja", "Guntur Sannam"], stages: ["Nursery", "Transplanting", "Vegetative", "Flowering", "Fruiting", "Harvest"] },
  { slug: "groundnut", name: "Groundnut", type: FarmType.AGRICULTURE, varieties: ["Kadiri 6"], stages: ["Germination", "Vegetative", "Flowering", "Pegging", "Pod development", "Harvest"] },
  { slug: "sugarcane", name: "Sugarcane", type: FarmType.AGRICULTURE, varieties: ["Co 86032"], stages: ["Germination", "Tillering", "Grand growth", "Maturity", "Harvest"] },
  { slug: "banana", name: "Banana", type: FarmType.AGRICULTURE, varieties: ["Grand Naine"], stages: ["Establishment", "Vegetative", "Shooting", "Bunch development", "Harvest"] },
  { slug: "mango", name: "Mango", type: FarmType.AGRICULTURE, varieties: ["Banganapalli", "Totapuri"], stages: ["Vegetative", "Flowering", "Fruit set", "Fruit development", "Harvest"] },
  { slug: "vegetables", name: "Vegetables", type: FarmType.AGRICULTURE, varieties: ["Mixed vegetables"], stages: ["Nursery", "Vegetative", "Flowering", "Fruiting", "Harvest"] },
  { slug: "tilapia", name: "Tilapia", type: FarmType.FISHERY, varieties: ["Nile Tilapia"], stages: ["Pond preparation", "Stocking", "Juvenile growth", "Grow-out", "Harvest"] },
  { slug: "rohu", name: "Rohu", type: FarmType.FISHERY, varieties: ["Rohu"], stages: ["Pond preparation", "Stocking", "Juvenile growth", "Grow-out", "Harvest"] }
];

async function upsertCatalog() {
  for (const definition of cropDefinitions) {
    const crop = await db.crop.upsert({ where: { slug: definition.slug }, update: { name: definition.name, type: definition.type }, create: { slug: definition.slug, name: definition.name, type: definition.type } });
    for (const name of definition.varieties) await db.cropVariety.upsert({ where: { cropId_name: { cropId: crop.id, name } }, update: {}, create: { cropId: crop.id, name } });
    for (const [sequence, name] of definition.stages.entries()) { const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-"); await db.cropStage.upsert({ where: { cropId_slug: { cropId: crop.id, slug } }, update: { name, sequence }, create: { cropId: crop.id, slug, name, sequence, typicalDays: 14 } }); }
  }
}

async function upsertRules() {
  const paddy = await db.crop.findUniqueOrThrow({ where: { slug: "paddy" }, include: { stages: true } });
  const cotton = await db.crop.findUniqueOrThrow({ where: { slug: "cotton" }, include: { stages: true } });
  const tilapia = await db.crop.findUniqueOrThrow({ where: { slug: "tilapia" }, include: { stages: true } });
  const stage = (crop: typeof paddy, slug: string) => crop.stages.find(s => s.slug === slug)!.id;
  const rules = [
    { key: "paddy-tillering-moisture", cropId: paddy.id, stageId: stage(paddy,"tillering"), type: "irrigation", title: "Irrigation monitoring", basePriority: Priority.HIGH, trigger: { sensor: "soilMoisture", lt: 38 }, action: "Inspect soil moisture and irrigation channels; irrigate only after confirming field conditions.", serviceCategory: "irrigation", safetyNote: "Avoid over-irrigation when rain is expected." },
    { key: "paddy-tillering-monitor", cropId: paddy.id, stageId: stage(paddy,"tillering"), type: "crop-protection", title: "Pest and nutrient monitoring", basePriority: Priority.MEDIUM, trigger: { always: true }, action: "Inspect representative plants and record symptoms before selecting any treatment.", serviceCategory: "crop-inspection", safetyNote: "Do not apply pesticides or fertilizer without diagnosis, label directions, and local agronomist verification." },
    { key: "paddy-harvest-machine", cropId: paddy.id, stageId: stage(paddy,"harvest"), type: "machinery", title: "Harvest preparation", basePriority: Priority.HIGH, trigger: { always: true }, action: "Confirm grain maturity, field access, transport, and harvester availability.", serviceCategory: "harvester", safetyNote: null },
    { key: "cotton-flowering-pest", cropId: cotton.id, stageId: stage(cotton,"flowering"), type: "crop-protection", title: "Flowering-stage pest monitoring", basePriority: Priority.HIGH, trigger: { always: true }, action: "Scout a representative field sample for sucking pests and flower damage; record observations.", serviceCategory: "sprayer", safetyNote: "A spray is not automatically advised. Confirm pest identity and economic threshold with a qualified agronomist." },
    { key: "cotton-flowering-heat", cropId: cotton.id, stageId: stage(cotton,"flowering"), type: "irrigation", title: "Heat and moisture inspection", basePriority: Priority.HIGH, trigger: { sensor: "airTemperature", gt: 36 }, action: "Check root-zone moisture during the cooler part of the day and review irrigation timing.", serviceCategory: "irrigation", safetyNote: null },
    { key: "tilapia-growout-do", cropId: tilapia.id, stageId: stage(tilapia,"grow-out"), type: "water-quality", title: "Dissolved oxygen action", basePriority: Priority.HIGH, trigger: { sensor: "dissolvedOxygen", lt: 5 }, action: "Check dissolved oxygen again and start safe aeration or water exchange if confirmed.", serviceCategory: "pond-service", safetyNote: "Very low dissolved oxygen can cause rapid fish stress; seek aquaculture professional support." },
    { key: "tilapia-growout-monitor", cropId: tilapia.id, stageId: stage(tilapia,"grow-out"), type: "water-quality", title: "Water quality monitoring", basePriority: Priority.MEDIUM, trigger: { always: true }, action: "Continue pH, temperature, dissolved oxygen and water-level monitoring.", serviceCategory: "pond-service", safetyNote: null }
  ];
  for (const rule of rules) await db.requirementRule.upsert({ where: { key: rule.key }, update: rule, create: rule });
}

async function upsertServices() {
  const services = [
    ["irrigation", "Irrigation Service", "irrigation", "acre", 450, "Pump, channel and field irrigation support"],
    ["sprayer", "Crop Sprayer", "sprayer", "acre", 850, "Professional calibrated spraying service"],
    ["tractor", "Tractor", "tractor", "hour", 1200, "Tractor with operator"],
    ["rotavator", "Rotavator", "rotavator", "acre", 1500, "Field preparation with rotavator"],
    ["harvester", "Combine Harvester", "harvester", "acre", 2500, "Harvesting with trained operator"],
    ["workers", "Farm Workers", "labour", "worker/day", 700, "Verified local agricultural workers"],
    ["drone", "Drone Service", "drone", "acre", 900, "Survey or approved application support"],
    ["pond-service", "Pond Water Service", "pond-service", "visit", 1200, "Water testing and pond support"],
    ["crop-inspection", "Agronomist Field Visit", "crop-inspection", "visit", 900, "Professional crop inspection and written advice"],
    ["transport", "Farm Transportation", "transport", "trip", 1600, "Produce and input transportation"],
    ["fertilizer-shop", "Fertilizer and Input Shop", "fertilizer-shop", "order", 500, "Verified fertilizer, seed and farm input shop with farmer-safe fulfilment"]
  ] as const;
  for (const [slug,name,category,unit,basePrice,description] of services) await db.service.upsert({ where: { slug }, update: { name, category, unit, basePrice, description }, create: { slug,name,category,unit,basePrice,description } });
}

async function demoData() {
  const passwordHash = await bcrypt.hash("Demo@123", 12);
  const farmer = await db.user.upsert({ where: { email: "farmer@demo.com" }, update: { passwordHash, emailVerified: new Date(), role: Role.FARMER }, create: { name: "Demo Farmer", email: "farmer@demo.com", passwordHash, emailVerified: new Date(), role: Role.FARMER } });
  const providerUser = await db.user.upsert({ where: { email: "provider@demo.com" }, update: { passwordHash, emailVerified: new Date(), role: Role.PROVIDER }, create: { name: "Ravi Farm Services", email: "provider@demo.com", passwordHash, emailVerified: new Date(), role: Role.PROVIDER } });
  const workerUser = await db.user.upsert({ where: { email: "worker@demo.com" }, update: { passwordHash, emailVerified: new Date(), role: Role.WORKER }, create: { name: "Lakshmi", email: "worker@demo.com", passwordHash, emailVerified: new Date(), role: Role.WORKER } });
  const admin = await db.user.upsert({ where: { email: "admin@demo.com" }, update: { passwordHash, emailVerified: new Date(), role: Role.ADMIN }, create: { name: "Platform Admin", email: "admin@demo.com", passwordHash, emailVerified: new Date(), role: Role.ADMIN } });
  void admin;
  const provider = await db.serviceProvider.upsert({ where: { userId: providerUser.id }, update: {}, create: { userId: providerUser.id, businessName: "Ravi Farm Services", district: "Guntur", verified: true, rating: 4.8 } });
  await db.worker.upsert({ where: { userId: workerUser.id }, update: {}, create: { userId: workerUser.id, skills: ["weeding", "harvesting", "transplanting"], district: "Guntur", dailyRate: 700, rating: 4.7 } });
  for (const service of await db.service.findMany()) await db.serviceProviderService.upsert({ where: { providerId_serviceId: { providerId: provider.id, serviceId: service.id } }, update: { available: true }, create: { providerId: provider.id, serviceId: service.id, price: service.basePrice } });
  if (!await db.machinery.findFirst({ where: { providerId: provider.id, type: "tractor" } })) await db.machinery.createMany({ data: [{ providerId: provider.id, type: "tractor", name: "Mahindra 575", hourlyRate: 1200, registration: "AP-DEMO-01" }, { providerId: provider.id, type: "harvester", name: "Paddy Combine", hourlyRate: 2500, registration: "AP-DEMO-02" }, { providerId: provider.id, type: "sprayer", name: "Power Sprayer", hourlyRate: 850 }] });

  const farms = [
    { name: "Syam Paddy Farm", type: FarmType.AGRICULTURE, area: 3, crop: "paddy", stage: "tillering", soilType: "Clay loam", irrigationType: "Canal", waterDepth: null },
    { name: "Syam Cotton Farm", type: FarmType.AGRICULTURE, area: 2, crop: "cotton", stage: "flowering", soilType: "Black soil", irrigationType: "Drip", waterDepth: null },
    { name: "Tilapia Fish Pond", type: FarmType.FISHERY, area: 1, crop: "tilapia", stage: "grow-out", soilType: null, irrigationType: null, waterDepth: 1.8 }
  ];
  for (const f of farms) {
    let farm = await db.farm.findFirst({ where: { ownerId: farmer.id, name: f.name } });
    if (!farm) farm = await db.farm.create({ data: { ownerId: farmer.id, name: f.name, type: f.type, area: f.area, areaUnit: "acre", location: "Guntur, Andhra Pradesh", state: "Andhra Pradesh", district: "Guntur", village: "Tenali", soilType: f.soilType, irrigationType: f.irrigationType, waterSource: f.type === FarmType.FISHERY ? "Borewell" : "Canal", farmingMethod: "Integrated", waterDepth: f.waterDepth } });
    const crop = await db.crop.findUniqueOrThrow({ where: { slug: f.crop }, include: { stages: true, varieties: true } }); const stage = crop.stages.find(s => s.slug === f.stage)!;
    if (!await db.farmCrop.findFirst({ where: { farmId: farm.id, active: true } })) await db.farmCrop.create({ data: { farmId: farm.id, cropId: crop.id, stageId: stage.id, varietyId: crop.varieties[0]?.id, sowingDate: new Date(Date.now() - 45 * 86400000), stockingDate: f.type === FarmType.FISHERY ? new Date(Date.now() - 60 * 86400000) : null, fishCount: f.type === FarmType.FISHERY ? 2200 : null } });
    if (!await db.sensorReading.findFirst({ where: { farmId: farm.id } })) await db.sensorReading.create({ data: f.type === FarmType.FISHERY ? { farmId: farm.id, scenario: "normal", ph: 7.2, airTemperature: 29, humidity: 72, waterLevel: 78, dissolvedOxygen: 5.8 } : { farmId: farm.id, scenario: "normal", soilMoisture: f.crop === "paddy" ? 34 : 46, soilTemperature: 27, airTemperature: 30, humidity: 69, ph: 6.8, waterLevel: 62, rainfall: 0, nitrogen: 54 } });
    if (!await db.weatherReading.findFirst({ where: { farmId: farm.id } })) await db.weatherReading.create({ data: { farmId: farm.id, provider: "demo-weather", temperature: 30, humidity: 68, rainProbability: 22, rainfall: 0, windSpeed: 9, forecast: [{ day: new Date().toISOString(), condition: "Partly cloudy", high: 32, low: 24 }] } });
  }
}

async function pilotData() {
  const passwordHash = await bcrypt.hash("FarmSecure@123", 12);
  const adminUser = await db.user.upsert({
    where: { email: "admin@aifarmbrain.in" },
    update: { name: "AI FarmBrain Admin", passwordHash, emailVerified: new Date(), role: Role.ADMIN },
    create: { name: "AI FarmBrain Admin", email: "admin@aifarmbrain.in", passwordHash, emailVerified: new Date(), role: Role.ADMIN }
  });
  void adminUser;
  const workerUser = await db.user.upsert({
    where: { email: "worker@aifarmbrain.in" },
    update: { name: "Field Worker Lakshmi", passwordHash, emailVerified: new Date(), role: Role.WORKER },
    create: { name: "Field Worker Lakshmi", email: "worker@aifarmbrain.in", passwordHash, emailVerified: new Date(), role: Role.WORKER }
  });
  await db.worker.upsert({ where: { userId: workerUser.id }, update: { skills: ["weeding", "harvesting", "transplanting", "loading"], district: "Guntur", dailyRate: 750, rating: 4.8, available: true }, create: { userId: workerUser.id, skills: ["weeding", "harvesting", "transplanting", "loading"], district: "Guntur", dailyRate: 750, rating: 4.8, available: true } });
  const farmers = [
    { email: "farmer1@aifarmbrain.in", name: "Syam Dumpala", farm: "Syam Paddy Production Farm", crop: "paddy", stage: "tillering", area: 3, soilType: "Clay loam", irrigationType: "Canal" },
    { email: "farmer2@aifarmbrain.in", name: "Lakshmi Reddy", farm: "Lakshmi Cotton Field", crop: "cotton", stage: "flowering", area: 2.5, soilType: "Black soil", irrigationType: "Drip" },
    { email: "farmer3@aifarmbrain.in", name: "Ravi Naidu", farm: "Ravi Fish Pond", crop: "tilapia", stage: "grow-out", area: 1.2, soilType: null, irrigationType: null }
  ] as const;
  const providerSectors = [
    { email: "transport@aifarmbrain.in", name: "Guntur Linked Transporters", service: "transport", price: 1500, machine: ["transport", "Covered Mini Truck", "AP-PILOT-TR01"] },
    { email: "fertilizer@aifarmbrain.in", name: "Sri Lakshmi Fertilizer Shop", service: "fertilizer-shop", price: 500, machine: null },
    { email: "machinery@aifarmbrain.in", name: "Delta Farm Machinery", service: "tractor", price: 1100, machine: ["tractor", "Mahindra 575 DI", "AP-PILOT-M01"] },
    { email: "inspection@aifarmbrain.in", name: "Guntur Agronomy Clinic", service: "crop-inspection", price: 850, machine: null }
  ] as const;
  const providers = new Map<string, { id: string }>();
  for (const sector of providerSectors) {
    const sectorUser = await db.user.upsert({
      where: { email: sector.email },
      update: { passwordHash, emailVerified: new Date(), role: Role.PROVIDER, name: sector.name },
      create: { name: sector.name, email: sector.email, passwordHash, emailVerified: new Date(), role: Role.PROVIDER }
    });
    const provider = await db.serviceProvider.upsert({
      where: { userId: sectorUser.id },
      update: { businessName: sector.name, district: "Guntur", verified: true, rating: 4.8 },
      create: { userId: sectorUser.id, businessName: sector.name, district: "Guntur", verified: true, rating: 4.8 }
    });
    const service = await db.service.findUniqueOrThrow({ where: { slug: sector.service } });
    await db.serviceProviderService.upsert({
      where: { providerId_serviceId: { providerId: provider.id, serviceId: service.id } },
      update: { available: true, price: sector.price },
      create: { providerId: provider.id, serviceId: service.id, available: true, price: sector.price }
    });
    if (sector.machine && !await db.machinery.findFirst({ where: { providerId: provider.id, type: sector.machine[0] } })) {
      await db.machinery.create({ data: { providerId: provider.id, type: sector.machine[0], name: sector.machine[1], registration: sector.machine[2], hourlyRate: sector.price } });
    }
    providers.set(sector.service, provider);
  }
  const transport = await db.service.findUniqueOrThrow({ where: { slug: "transport" } });
  const fertilizer = await db.service.findUniqueOrThrow({ where: { slug: "fertilizer-shop" } });
  for (const item of farmers) {
    const user = await db.user.upsert({
      where: { email: item.email },
      update: { name: item.name, passwordHash, emailVerified: new Date(), role: Role.FARMER },
      create: { name: item.name, email: item.email, passwordHash, emailVerified: new Date(), role: Role.FARMER }
    });
    let farm = await db.farm.findFirst({ where: { ownerId: user.id, name: item.farm } });
    if (!farm) farm = await db.farm.create({
      data: {
        ownerId: user.id,
        name: item.farm,
        type: item.crop === "tilapia" ? FarmType.FISHERY : FarmType.AGRICULTURE,
        area: item.area,
        areaUnit: "acre",
        location: "Guntur, Andhra Pradesh",
        state: "Andhra Pradesh",
        district: "Guntur",
        village: "Tenali",
        soilType: item.soilType,
        irrigationType: item.irrigationType,
        waterSource: item.crop === "tilapia" ? "Borewell" : "Canal",
        farmingMethod: "Integrated",
        waterDepth: item.crop === "tilapia" ? 1.7 : null
      }
    });
    const crop = await db.crop.findUniqueOrThrow({ where: { slug: item.crop }, include: { stages: true, varieties: true } });
    const stage = crop.stages.find((s) => s.slug === item.stage)!;
    let farmCrop = await db.farmCrop.findFirst({ where: { farmId: farm.id, active: true } });
    if (!farmCrop) farmCrop = await db.farmCrop.create({ data: { farmId: farm.id, cropId: crop.id, stageId: stage.id, varietyId: crop.varieties[0]?.id, sowingDate: new Date(Date.now() - 40 * 86400000), stockingDate: item.crop === "tilapia" ? new Date(Date.now() - 55 * 86400000) : null, fishCount: item.crop === "tilapia" ? 1800 : null } });
    if (!await db.sensorReading.findFirst({ where: { farmId: farm.id } })) await db.sensorReading.create({ data: item.crop === "tilapia" ? { farmId: farm.id, scenario: "normal", ph: 7.1, airTemperature: 29, humidity: 70, waterLevel: 76, dissolvedOxygen: 5.6 } : { farmId: farm.id, scenario: "normal", soilMoisture: item.crop === "paddy" ? 35 : 44, soilTemperature: 27, airTemperature: 31, humidity: 68, ph: 6.8, waterLevel: 61, rainfall: 0, nitrogen: 53 } });
    if (!await db.weatherReading.findFirst({ where: { farmId: farm.id } })) await db.weatherReading.create({ data: { farmId: farm.id, provider: "pilot-weather", temperature: 31, humidity: 67, rainProbability: 20, rainfall: 0, windSpeed: 8, forecast: [{ day: new Date().toISOString(), condition: "Partly cloudy", high: 33, low: 24 }] } });
    if (!await db.booking.findFirst({ where: { farmId: farm.id, serviceId: transport.id, providerId: null, status: "REQUESTED", notes: "Open transporter request - first provider accepts" } })) {
      await db.booking.create({ data: { userId: user.id, farmId: farm.id, farmCropId: farmCrop.id, serviceId: transport.id, scheduledAt: new Date(Date.now() + 2 * 86400000), location: farm.location, estimatedPrice: transport.basePrice, notes: "Open transporter request - first provider accepts" } });
    }
    if (item.email === "farmer1@aifarmbrain.in" && !await db.booking.findFirst({ where: { farmId: farm.id, serviceId: fertilizer.id, providerId: null, status: "REQUESTED", notes: "Open fertilizer shop request - first input shop accepts" } })) {
      await db.booking.create({ data: { userId: user.id, farmId: farm.id, farmCropId: farmCrop.id, serviceId: fertilizer.id, scheduledAt: new Date(Date.now() + 3 * 86400000), location: farm.location, estimatedPrice: fertilizer.basePrice, notes: "Open fertilizer shop request - first input shop accepts" } });
    }
    await analyzeFarm(farm.id, user.id);
  }
}

async function main() {
  await upsertCatalog();
  await upsertRules();
  await upsertServices();
  await demoData();
  await pilotData();
  const farmer = await db.user.findUniqueOrThrow({ where: { email: "farmer@demo.com" } });
  for (const farm of await db.farm.findMany({ where: { ownerId: farmer.id } })) await analyzeFarm(farm.id, farmer.id);
  console.log("Seeded AI Farm Brain pilot data, linked transporters, and farm-specific analyses.");
}
main().finally(() => db.$disconnect());
