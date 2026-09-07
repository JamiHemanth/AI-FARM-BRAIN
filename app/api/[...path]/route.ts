import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { BookingStatus, NotificationType, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, body, fail, ok } from "@/lib/api";
import { clearSession, createSession, requireFarm, requireUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { activitySchema, bookingSchema, farmSchema, loginSchema, registerSchema } from "@/lib/validation";
import { sensorProvider, SensorScenario } from "@/lib/sensors";
import { weatherProvider } from "@/lib/weather";
import { analyzeFarm } from "@/lib/requirements";
import { z } from "zod";
import { detectLanguage, translate, type Language } from "@/lib/i18n-core";

type Context = { params: Promise<{ path: string[] }> };
const segments = async (context: Context) => (await context.params).path || [];
const ip = (request: NextRequest) => request.headers.get("x-forwarded-for")?.split(",")[0] || "local";

export async function GET(request: NextRequest, context: Context) {
  try {
    const p = await segments(context);
    if (p[0] === "health") return ok({ status: "healthy", demoMode: process.env.DEMO_MODE !== "false", timestamp: new Date().toISOString() });
    if (p[0] === "auth" && p[1] === "me") return await getMe();
    if (p[0] === "catalog") return await getCatalog();
    if (p[0] === "farms" && !p[1]) return await getFarms();
    if (p[0] === "farms" && p[1] && !p[2]) return await getFarm(p[1]);
    if (p[0] === "farms" && p[2] === "dashboard") return await getDashboard(p[1]);
    if (p[0] === "farms" && p[2] === "requirements") return await getRequirements(p[1]);
    if (p[0] === "farms" && p[2] === "recommendations") return await getRecommendations(p[1]);
    if (p[0] === "farms" && p[2] === "sensors") return await getSensors(p[1]);
    if (p[0] === "farms" && p[2] === "weather") return await getWeather(p[1]);
    if (p[0] === "farms" && p[2] === "activities") return await getActivities(p[1]);
    if (p[0] === "farms" && p[2] === "expenses") return await getExpenses(p[1]);
    if (p[0] === "farms" && p[2] === "analytics") return await getAnalytics(p[1]);
    if (p[0] === "services") return await getServices(request);
    if (p[0] === "bookings") return await getBookings(p[1]);
    if (p[0] === "notifications") return await getNotifications();
    if (p[0] === "provider" && p[1] === "dashboard") return await getProviderDashboard();
    if (p[0] === "worker" && p[1] === "dashboard") return await getWorkerDashboard();
    if (p[0] === "admin" && p[1] === "dashboard") return await getAdminDashboard();
    throw new ApiError(404, "API route not found.");
  } catch (error) { return fail(error); }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const p = await segments(context);
    if (p[0] === "auth" && p[1] === "register") return await register(request);
    if (p[0] === "auth" && p[1] === "login") return await login(request);
    if (p[0] === "auth" && p[1] === "logout") { await clearSession(); return ok({ loggedOut: true }); }
    if (p[0] === "farms" && !p[1]) return await createFarm(request);
    if (p[0] === "farms" && p[2] === "demo-sensors" && p[3] === "simulate") return await simulate(request, p[1]);
    if (p[0] === "farms" && p[2] === "weather" && p[3] === "refresh") return await refreshWeather(p[1]);
    if (p[0] === "farms" && p[2] === "requirements" && p[3] === "generate") return await analyze(request, p[1]);
    if (p[0] === "farms" && p[2] === "activities") return await createActivity(request, p[1]);
    if (p[0] === "bookings") return await createBooking(request);
    if (p[0] === "ai" && p[1] === "farm-analysis") return await analyzeFromBody(request);
    if (p[0] === "ai" && p[1] === "chat") return await chat(request);
    throw new ApiError(404, "API route not found.");
  } catch (error) { return fail(error); }
}

export async function PUT(request: NextRequest, context: Context) {
  try {
    const p = await segments(context);
    if (p[0] === "farms" && p[1] && !p[2]) return await updateFarm(request, p[1]);
    if (p[0] === "bookings" && p[1] && p[2] === "status") return await updateBooking(request, p[1]);
    if (p[0] === "requirements" && p[1] && p[2] === "complete") return await completeRequirement(request, p[1]);
    if (p[0] === "notifications" && p[1] === "read-all") return await readNotifications();
    throw new ApiError(404, "API route not found.");
  } catch (error) { return fail(error); }
}

export async function DELETE(_request: NextRequest, context: Context) {
  try {
    const p = await segments(context);
    if (p[0] === "farms" && p[1]) {
      const { user, farm } = await requireFarm(p[1]);
      if (farm.ownerId !== user.id && user.role !== "ADMIN") throw new ApiError(403, "Only the farm owner can delete this farm.");
      await db.farm.delete({ where: { id: farm.id } });
      return ok({ deleted: true });
    }
    throw new ApiError(404, "API route not found.");
  } catch (error) { return fail(error); }
}

async function register(request: NextRequest) {
  rateLimit(`register:${ip(request)}`, 5, 15 * 60_000);
  const input = await body(request, registerSchema);
  const existing = await db.user.findUnique({ where: { email: input.email } });
  if (existing?.emailVerified) throw new ApiError(409, "An account with this email already exists.");
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = existing
    ? await db.user.update({ where: { id: existing.id }, data: { name: input.name, passwordHash, emailVerified: new Date() } })
    : await db.user.create({ data: { name: input.name, email: input.email, passwordHash, emailVerified: new Date() } });
  await createSession({ userId: user.id, email: user.email, role: user.role });
  await db.auditLog.create({ data: { userId: user.id, action: "REGISTER", entity: "User", entityId: user.id, ipAddress: ip(request) } });
  return ok({ email: user.email, user: { id: user.id, name: user.name, email: user.email, role: user.role } }, 201);
}

async function login(request: NextRequest) {
  rateLimit(`login:${ip(request)}`, 8, 15 * 60_000);
  const input = await body(request, loginSchema);
  const user = await db.user.findUnique({ where: { email: input.email } });
  if (!user || !await bcrypt.compare(input.password, user.passwordHash)) throw new ApiError(401, "Email or password is incorrect.");
  await createSession({ userId: user.id, email: user.email, role: user.role });
  await db.auditLog.create({ data: { userId: user.id, action: "LOGIN", entity: "User", entityId: user.id, ipAddress: ip(request) } });
  return ok({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}

async function getMe() {
  const user = await requireUser();
  return ok({ id: user.id, name: user.name, email: user.email, role: user.role, language: user.language });
}

async function getCatalog() {
  await requireUser();
  const crops = await db.crop.findMany({ include: { varieties: true, stages: { orderBy: { sequence: "asc" } } }, orderBy: { name: "asc" } });
  return ok({ crops });
}

async function getFarms() {
  const user = await requireUser();
  const farms = await db.farm.findMany({ where: user.role === "ADMIN" ? {} : { OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }] },
    include: { crops: { where: { active: true }, include: { crop: true, stage: true } }, _count: { select: { requirements: { where: { status: "OPEN" } }, notifications: { where: { readAt: null } } } } }, orderBy: { updatedAt: "desc" } });
  return ok(farms);
}

async function getFarm(id: string) { const { farm } = await requireFarm(id); return ok(farm); }

async function createFarm(request: NextRequest) {
  const user = await requireUser([Role.FARMER, Role.ADMIN]);
  const input = await body(request, farmSchema);
  const crop = await db.crop.findFirst({ where: { id: input.cropId, type: input.type, stages: { some: { id: input.stageId } } } });
  if (!crop) throw new ApiError(400, "The selected crop/species and stage do not match this farm type.");
  const farm = await db.$transaction(async (tx) => {
    const created = await tx.farm.create({ data: { ownerId: user.id, name: input.name, type: input.type, location: input.location, state: input.state, district: input.district, village: input.village,
      area: input.area, areaUnit: input.areaUnit, soilType: input.soilType, irrigationType: input.irrigationType, waterSource: input.waterSource, farmingMethod: input.farmingMethod, waterDepth: input.waterDepth } });
    await tx.farmCrop.create({ data: { farmId: created.id, cropId: input.cropId, varietyId: input.varietyId || null, stageId: input.stageId,
      sowingDate: input.sowingDate ? new Date(input.sowingDate) : null, stockingDate: input.type === "FISHERY" && input.sowingDate ? new Date(input.sowingDate) : null, fishCount: input.fishCount } });
    await tx.auditLog.create({ data: { userId: user.id, farmId: created.id, action: "CREATE", entity: "Farm", entityId: created.id } });
    return created;
  });
  await seedCurrentConditions(farm.id, user.id);
  return ok(farm, 201);
}

async function updateFarm(request: NextRequest, id: string) {
  const { user, farm } = await requireFarm(id);
  if (farm.ownerId !== user.id && user.role !== "ADMIN") throw new ApiError(403, "Only the farm owner can edit this farm.");
  const input = await body(request, farmSchema.partial().omit({ cropId: true, stageId: true }));
  const updated = await db.farm.update({ where: { id }, data: input });
  return ok(updated);
}

async function seedCurrentConditions(farmId: string, userId: string) {
  const { farm } = await requireFarm(farmId);
  const reading = await sensorProvider().read(farmId, farm.type, "normal");
  const weather = await weatherProvider().current(farm);
  await db.$transaction([
    db.sensorReading.create({ data: { farmId, ...reading } }),
    db.weatherReading.create({ data: { farmId, ...weather } })
  ]);
  void analyzeFarm(farmId, userId).catch((error) => console.error("Initial farm analysis failed", error));
}

async function getDashboard(id: string) {
  const { farm } = await requireFarm(id);
  const [sensor, weather, requirements, activities, bookings, recommendations, healthHistory] = await Promise.all([
    db.sensorReading.findFirst({ where: { farmId: id }, orderBy: { observedAt: "desc" } }), db.weatherReading.findFirst({ where: { farmId: id }, orderBy: { observedAt: "desc" } }),
    db.requirement.findMany({ where: { farmId: id, status: "OPEN" }, orderBy: [{ priority: "asc" }, { generatedAt: "desc" }], take: 10 }),
    db.activity.findMany({ where: { farmId: id }, orderBy: { createdAt: "desc" }, take: 8 }), db.booking.findMany({ where: { farmId: id }, include: { service: true, provider: true }, orderBy: { createdAt: "desc" }, take: 5 }),
    db.recommendation.findMany({ where: { farmId: id }, orderBy: { createdAt: "desc" }, take: 5 }), db.farmHealthScore.findMany({ where: { farmId: id }, orderBy: { recordedAt: "asc" }, take: 20 })
  ]);
  const rank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 } as const;
  requirements.sort((a, b) => rank[b.priority] - rank[a.priority]);
  return ok({ farm, sensor, weather, requirements, activities, bookings, recommendations, healthHistory });
}

async function getRequirements(id: string) { await requireFarm(id); return ok(await db.requirement.findMany({ where: { farmId: id }, include: { farmCrop: { include: { crop: true, stage: true } } }, orderBy: { generatedAt: "desc" } })); }
async function getRecommendations(id: string) { await requireFarm(id); return ok(await db.recommendation.findMany({ where: { farmId: id }, orderBy: { createdAt: "desc" } })); }
async function getSensors(id: string) { await requireFarm(id); return ok(await db.sensorReading.findMany({ where: { farmId: id }, orderBy: { observedAt: "desc" }, take: 50 })); }
async function getWeather(id: string) { await requireFarm(id); return ok(await db.weatherReading.findMany({ where: { farmId: id }, orderBy: { observedAt: "desc" }, take: 10 })); }
async function getActivities(id: string) { await requireFarm(id); return ok(await db.activity.findMany({ where: { farmId: id }, orderBy: { createdAt: "desc" } })); }
async function getExpenses(id: string) { await requireFarm(id); return ok(await db.expense.findMany({ where: { farmId: id }, orderBy: { occurredAt: "desc" } })); }
async function getAnalytics(id: string) { await requireFarm(id); const [health, sensors, expenses] = await Promise.all([db.farmHealthScore.findMany({ where: { farmId: id }, orderBy: { recordedAt: "asc" }, take: 50 }), db.sensorReading.findMany({ where: { farmId: id }, orderBy: { observedAt: "asc" }, take: 50 }), db.expense.groupBy({ by: ["category"], where: { farmId: id }, _sum: { amount: true } })]); return ok({ health, sensors, expenses }); }

async function simulate(request: NextRequest, id: string) {
  const { user, farm } = await requireFarm(id);
  const { scenario } = await body(request, z.object({ scenario: z.enum(["normal", "low-moisture", "high-temperature", "disease-risk", "rainfall", "water-shortage"]).default("normal") }));
  const previous = await db.sensorReading.findFirst({ where: { farmId: id }, orderBy: { observedAt: "desc" } });
  const values = await sensorProvider().read(id, farm.type, scenario as SensorScenario, previous);
  const reading = await db.sensorReading.create({ data: { farmId: id, ...values } });
  const analysis = await analyzeFarm(id, user.id);
  if (analysis.riskLevel === "critical" || analysis.riskLevel === "high") await db.notification.create({ data: { userId: farm.ownerId, farmId: id, type: NotificationType.ALERT, title: `${analysis.riskLevel.toUpperCase()} farm alert`, message: `${farm.name} needs attention after the latest sensor update.` } });
  return ok({ reading, analysis }, 201);
}

async function refreshWeather(id: string) {
  const { farm } = await requireFarm(id); const values = await weatherProvider().current(farm);
  return ok(await db.weatherReading.create({ data: { farmId: id, ...values } }), 201);
}
async function analyze(_request: NextRequest, id: string) { const user = await requireUser(); return ok(await analyzeFarm(id, user.id), 201); }
async function analyzeFromBody(request: NextRequest) { const user = await requireUser(); const { farmId } = await body(request, z.object({ farmId: z.string() })); return ok(await analyzeFarm(farmId, user.id), 201); }

async function createActivity(request: NextRequest, id: string) {
  const { user } = await requireFarm(id); const input = await body(request, activitySchema);
  if (input.requirementId && !await db.requirement.findFirst({ where: { id: input.requirementId, farmId: id } })) throw new ApiError(400, "Requirement does not belong to this farm.");
  const activity = await db.$transaction(async tx => {
    const created = await tx.activity.create({ data: { farmId: id, requirementId: input.requirementId, title: input.title, notes: input.notes, cost: input.cost, status: input.completed ? "completed" : "planned", completedAt: input.completed ? new Date() : null } });
    if (input.cost) await tx.expense.create({ data: { farmId: id, category: "activity", description: input.title, amount: input.cost } });
    if (input.requirementId && input.completed) await tx.requirement.update({ where: { id: input.requirementId }, data: { status: "COMPLETED", completedAt: new Date() } });
    return created;
  });
  if (input.completed) await analyzeFarm(id, user.id);
  return ok(activity, 201);
}

async function completeRequirement(request: NextRequest, requirementId: string) {
  const user = await requireUser(); const requirement = await db.requirement.findUnique({ where: { id: requirementId } });
  if (!requirement) throw new ApiError(404, "Requirement not found."); await requireFarm(requirement.farmId);
  const { notes, cost } = await body(request, z.object({ notes: z.string().optional(), cost: z.coerce.number().nonnegative().optional() }));
  await db.$transaction(async tx => { await tx.requirement.update({ where: { id: requirementId }, data: { status: "COMPLETED", completedAt: new Date() } }); await tx.activity.create({ data: { farmId: requirement.farmId, requirementId, title: requirement.title, notes, cost, status: "completed", completedAt: new Date() } }); if (cost) await tx.expense.create({ data: { farmId: requirement.farmId, category: requirement.type, description: requirement.title, amount: cost } }); });
  return ok(await analyzeFarm(requirement.farmId, user.id));
}

async function getServices(request: NextRequest) {
  await requireUser(); const category = request.nextUrl.searchParams.get("category"); const district = request.nextUrl.searchParams.get("district");
  return ok(await db.service.findMany({ where: { active: true, ...(category ? { category } : {}) }, include: { providers: { where: { available: true, ...(district ? { provider: { district: { equals: district, mode: "insensitive" } } } : {}) }, include: { provider: true } } }, orderBy: { name: "asc" } }));
}

async function createBooking(request: NextRequest) {
  const user = await requireUser([Role.FARMER, Role.ADMIN]); const input = await body(request, bookingSchema); const { farm } = await requireFarm(input.farmId);
  const farmCrop = await db.farmCrop.findFirst({ where: { id: input.farmCropId, farmId: farm.id, active: true } });
  if (!farmCrop) throw new ApiError(400, "The selected crop does not belong to this farm.");
  if (input.requirementId && !await db.requirement.findFirst({ where: { id: input.requirementId, farmId: farm.id, farmCropId: farmCrop.id } })) throw new ApiError(400, "The requirement does not belong to this farm and crop.");
  const service = await db.service.findUnique({ where: { id: input.serviceId } }); if (!service?.active) throw new ApiError(400, "This service is not available.");
  const providerService = input.providerId ? await db.serviceProviderService.findUnique({ where: { providerId_serviceId: { providerId: input.providerId, serviceId: service.id } } }) : null;
  if (input.providerId && !providerService?.available) throw new ApiError(400, "This provider is not available for the selected service.");
  const price = (providerService?.price ?? service.basePrice) * farm.area;
  const booking = await db.$transaction(async tx => {
    const created = await tx.booking.create({ data: { userId: user.id, farmId: farm.id, farmCropId: farmCrop.id, requirementId: input.requirementId, serviceId: service.id, providerId: input.providerId, scheduledAt: new Date(input.scheduledAt), location: farm.location, estimatedPrice: price, notes: input.notes } });
    await tx.bookingStatusHistory.create({ data: { bookingId: created.id, status: "REQUESTED", note: "Booking requested by farmer" } });
    await tx.notification.create({ data: { userId: user.id, farmId: farm.id, type: "BOOKING", title: "Booking requested", message: `${service.name} was requested for ${farm.name}.` } });
    return created;
  });
  return ok(booking, 201);
}

async function getBookings(id?: string) {
  const user = await requireUser(); if (id) { const booking = await db.booking.findFirst({ where: user.role === "ADMIN" ? { id } : user.role === "PROVIDER" ? { id, provider: { userId: user.id } } : { id, userId: user.id }, include: { farm: true, farmCrop: { include: { crop: true, stage: true } }, service: true, provider: true, history: true } }); if (!booking) throw new ApiError(404, "Booking not found."); return ok(booking); }
  return ok(await db.booking.findMany({ where: user.role === "ADMIN" ? {} : user.role === "PROVIDER" ? { provider: { userId: user.id } } : { userId: user.id }, include: { farm: true, service: true, provider: true }, orderBy: { createdAt: "desc" } }));
}

async function updateBooking(request: NextRequest, id: string) {
  const user = await requireUser(); const { status, note } = await body(request, z.object({ status: z.nativeEnum(BookingStatus), note: z.string().optional() }));
  const booking = await db.booking.findUnique({ where: { id }, include: { provider: true, service: true } }); if (!booking) throw new ApiError(404, "Booking not found.");
  const currentProvider = user.role === "PROVIDER" ? await db.serviceProvider.findFirst({ where: { userId: user.id }, include: { services: true } }) : null;
  const canClaimOpenRequest = !!currentProvider && !booking.providerId && booking.status === "REQUESTED" && status === "ACCEPTED" && currentProvider.services.some((item) => item.serviceId === booking.serviceId && item.available);
  const allowed = user.role === "ADMIN" || booking.userId === user.id || booking.provider?.userId === user.id || canClaimOpenRequest; if (!allowed) throw new ApiError(403, "You cannot update this booking.");
  const providerTargets: BookingStatus[] = ["ACCEPTED", "REJECTED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED"];
  const farmerTargets: BookingStatus[] = ["CANCELLED", "COMPLETED"];
  if (user.role !== "ADMIN" && booking.provider?.userId !== user.id && !canClaimOpenRequest && !farmerTargets.includes(status)) throw new ApiError(403, "Only the assigned provider can make this status change.");
  if (user.role !== "ADMIN" && booking.userId !== user.id && !providerTargets.includes(status)) throw new ApiError(403, "Only the farmer can cancel this booking.");
  const transitions: Record<BookingStatus, BookingStatus[]> = { REQUESTED: ["ACCEPTED", "REJECTED", "CANCELLED"], ACCEPTED: ["EN_ROUTE", "CANCELLED"], EN_ROUTE: ["IN_PROGRESS", "CANCELLED"], IN_PROGRESS: ["COMPLETED"], COMPLETED: [], CANCELLED: [], REJECTED: [] };
  if (!transitions[booking.status].includes(status)) throw new ApiError(400, `Cannot change booking from ${booking.status} to ${status}.`);
  const updated = await db.$transaction(async tx => { if (canClaimOpenRequest) { const claimed = await tx.booking.updateMany({ where: { id, providerId: null, status: "REQUESTED" }, data: { providerId: currentProvider!.id, status: "ACCEPTED" } }); if (claimed.count !== 1) throw new ApiError(409, "This request was already accepted by another provider."); } const b = canClaimOpenRequest ? await tx.booking.findUniqueOrThrow({ where: { id } }) : await tx.booking.update({ where: { id }, data: { status } }); await tx.bookingStatusHistory.create({ data: { bookingId: id, status, note: note || (canClaimOpenRequest ? "Provider accepted this open request first." : undefined) } }); await tx.notification.create({ data: { userId: booking.userId, farmId: booking.farmId, type: "BOOKING", title: `Booking ${status.toLowerCase().replace("_", " ")}`, message: `${booking.service.name} status changed to ${status}.` } }); if (status === "COMPLETED") { await tx.expense.create({ data: { farmId: booking.farmId, category: "service", description: booking.service.name, amount: booking.estimatedPrice } }); if (booking.requirementId) await tx.requirement.update({ where: { id: booking.requirementId }, data: { status: "COMPLETED", completedAt: new Date() } }); await tx.activity.create({ data: { farmId: booking.farmId, requirementId: booking.requirementId, title: booking.service.name, status: "completed", completedAt: new Date(), cost: booking.estimatedPrice } }); } return b; });
  if (status === "COMPLETED") await analyzeFarm(booking.farmId, booking.userId);
  return ok(updated);
}

async function getNotifications() { const user = await requireUser(); return ok(await db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 })); }
async function readNotifications() { const user = await requireUser(); await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } }); return ok({ read: true }); }

async function chat(request: NextRequest) {
  const user = await requireUser(); const { farmId, question, language } = await body(request, z.object({ farmId: z.string().min(1), question: z.string().trim().min(2).max(1000), language: z.enum(["en","te","hi"]).default("en") })); const { farm } = await requireFarm(farmId);
  const [requirements, sensor, weather, activities] = await Promise.all([db.requirement.findMany({ where: { farmId, status: "OPEN" }, orderBy: { generatedAt: "desc" }, take: 5 }), db.sensorReading.findFirst({ where: { farmId }, orderBy: { observedAt: "desc" } }), db.weatherReading.findFirst({ where: { farmId }, orderBy: { observedAt: "desc" } }), db.activity.findMany({ where: { farmId }, orderBy: { createdAt: "desc" }, take: 5 })]);
  const crop = farm.crops[0]; const top = requirements[0]; const responseLanguage = detectLanguage(question, language as Language);
  const farmName = translate(responseLanguage, farm.name), cropName = translate(responseLanguage, crop.crop.name), stageName = translate(responseLanguage, crop.stage.name), title = translate(responseLanguage, top?.title), service = translate(responseLanguage, top?.requiredService);
  const answer = top ? localizedAnswer(responseLanguage, farmName, cropName, stageName, title, top.priority, top.reason, service) : localizedStableAnswer(responseLanguage, farmName, cropName);
  const safety = localizedSafety(responseLanguage);
  const contextData = { userId: user.id, farmId, crop: crop.crop.name, stage: crop.stage.name, area: farm.area, soil: farm.soilType, irrigation: farm.irrigationType, sensor, weather, recentActivities: activities, requirements };
  const saved = await db.aiInteraction.create({ data: { userId: user.id, farmId, question, context: contextData, response: { answer, farmId, language: responseLanguage, citedRequirementId: top?.id }, model: "farm-context-assistant-v2" } });
  return ok({ answer, interactionId: saved.id, farmId, safety });
}

function localizedAnswer(language: Language, farmName: string, cropName: string, stageName: string, title: string, priority: string, reason: string, service?: string) {
  if (language === "te") return `${farmName}లో ${cropName} (${stageName}) కోసం ముందుగా "${title}"పై దృష్టి పెట్టండి. ప్రాధాన్యం: ${priority}. కారణం: ${reason} తదుపరి చర్య: ${service ? `${service} సేవను పరిశీలించి అవసరమైతే బుక్ చేయండి` : "పొలాన్ని పరిశీలించి చేసిన పనిని నమోదు చేయండి"}.`;
  if (language === "hi") return `${farmName} में ${cropName} (${stageName}) के लिए पहले "${title}" पर ध्यान दें. प्राथमिकता: ${priority}. कारण: ${reason} अगला कदम: ${service ? `${service} सेवा देखें और जरूरत हो तो बुक करें` : "खेत की जांच करें और कार्रवाई दर्ज करें"}.`;
  return `For ${farmName}'s ${cropName} at ${stageName}, focus first on ${title.toLowerCase()} (${priority.toLowerCase()} priority). ${reason} Recommended next step: ${service ? `review and book ${service} if needed` : "inspect the field and record the action"}.`;
}

function localizedStableAnswer(language: Language, farmName: string, cropName: string) {
  if (language === "te") return `${farmName}లోని ${cropName}కి ప్రస్తుతం తెరిచి ఉన్న అవసరాలు లేవు. తాజా సెన్సర్ మరియు వాతావరణ రీడింగ్స్‌ను పర్యవేక్షించండి. పరిస్థితులు మారిన తర్వాత మళ్లీ విశ్లేషణ చేయండి.`;
  if (language === "hi") return `${farmName} की ${cropName} फसल के लिए अभी कोई खुली जरूरत नहीं है. ताजा सेंसर और मौसम रीडिंग देखते रहें. स्थिति बदलने पर फिर विश्लेषण चलाएं.`;
  return `${farmName}'s ${cropName} currently has no open requirements. Continue monitoring the latest sensor and weather readings, and run a new analysis after conditions change.`;
}

function localizedSafety(language: Language) {
  if (language === "te") return "పురుగుమందు, ఎరువు, వ్యాధి లేదా మోతాదు నిర్ణయాలకు ముందు అర్హత కలిగిన స్థానిక వ్యవసాయ నిపుణుడితో ధృవీకరించండి మరియు ఉత్పత్తి లేబుల్ సూచనలు పాటించండి.";
  if (language === "hi") return "कीटनाशक, उर्वरक, रोग या मात्रा से जुड़े निर्णयों से पहले योग्य स्थानीय कृषि विशेषज्ञ से पुष्टि करें और उत्पाद लेबल व स्थानीय निर्देशों का पालन करें.";
  return "For pesticide, fertilizer, disease, or dosage decisions, verify the recommendation with a qualified local agronomist and follow product labels and local guidance.";
}

async function getProviderDashboard() {
  const user = await requireUser([Role.PROVIDER, Role.ADMIN]);
  const provider = await db.serviceProvider.findFirst({
    where: user.role === "ADMIN" ? {} : { userId: user.id },
    include: {
      services: { include: { service: true } },
      machinery: true,
      bookings: { include: { farm: true, service: true }, orderBy: { createdAt: "desc" } }
    }
  });
  if (!provider) return ok(provider);
  const serviceIds = provider.services.map((item) => item.serviceId);
  const openRequests = await db.booking.findMany({
    where: { providerId: null, status: "REQUESTED", serviceId: { in: serviceIds } },
    include: { farm: true, service: true },
    orderBy: { createdAt: "asc" }
  });
  return ok({ ...provider, bookings: [...openRequests, ...provider.bookings] });
}
async function getWorkerDashboard() { const user = await requireUser([Role.WORKER, Role.ADMIN]); return ok(await db.worker.findFirst({ where: user.role === "ADMIN" ? {} : { userId: user.id }, include: { user: { select: { name: true, email: true } } } })); }
async function getAdminDashboard() { await requireUser([Role.ADMIN]); const [users, farms, bookings, openRequirements] = await Promise.all([db.user.count(), db.farm.count(), db.booking.count(), db.requirement.count({ where: { status: "OPEN" } })]); return ok({ users, farms, bookings, openRequirements, recentAudit: await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 30 }) }); }
