import { z } from "zod";

export const email = z.string().trim().email().toLowerCase();
export const registerSchema = z.object({ name: z.string().trim().min(2).max(80), email, password: z.string().min(8).max(128) });
export const loginSchema = z.object({ email, password: z.string().min(1) });
export const farmSchema = z.object({
  name: z.string().trim().min(2).max(100), type: z.enum(["AGRICULTURE", "FISHERY"]), location: z.string().trim().min(2),
  state: z.string().trim().min(2), district: z.string().trim().min(2), village: z.string().trim().min(2),
  area: z.coerce.number().positive().max(100000), areaUnit: z.string().default("acre"), soilType: z.string().optional(),
  irrigationType: z.string().optional(), waterSource: z.string().optional(), farmingMethod: z.string().optional(), waterDepth: z.coerce.number().positive().optional(),
  cropId: z.string().min(1), varietyId: z.string().optional(), stageId: z.string().min(1), sowingDate: z.string().optional(), fishCount: z.coerce.number().int().positive().optional()
});
export const activitySchema = z.object({ title: z.string().trim().min(2), notes: z.string().optional(), requirementId: z.string().optional(), cost: z.coerce.number().nonnegative().optional(), completed: z.boolean().default(false) });
export const bookingSchema = z.object({ farmId: z.string(), farmCropId: z.string(), requirementId: z.string().optional(), serviceId: z.string(), providerId: z.string().optional(), scheduledAt: z.string().datetime(), notes: z.string().max(500).optional() });
