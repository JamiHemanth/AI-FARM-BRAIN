import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";

const COOKIE = "farm_session";
const secret = () => new TextEncoder().encode(process.env.JWT_SECRET || "development-only-secret-change-me-32chars");

export type Session = { userId: string; role: Role; email: string };

export async function createSession(session: Session) {
  const token = await new SignJWT(session).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").setIssuer("ai-farm-brain").sign(secret());
  const jar = await cookies();
  jar.set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
}

export async function clearSession() { (await cookies()).delete(COOKIE); }

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try { return (await jwtVerify(token, secret(), { issuer: "ai-farm-brain" })).payload as unknown as Session; }
  catch { return null; }
}

export async function requireUser(roles?: Role[]) {
  const session = await getSession();
  if (!session) throw new ApiError(401, "Please log in to continue.");
  if (roles && !roles.includes(session.role)) throw new ApiError(403, "You do not have permission to perform this action.");
  const user = await db.user.findUnique({ where: { id: session.userId } });
  if (!user) throw new ApiError(401, "Your session is no longer valid.");
  return user;
}

export async function requireFarm(farmId: string, roles?: Role[]) {
  const user = await requireUser(roles);
  const farm = await db.farm.findFirst({
    where: user.role === "ADMIN" ? { id: farmId } : { id: farmId, OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }] },
    include: { crops: { where: { active: true }, include: { crop: true, stage: true, variety: true } } }
  });
  if (!farm) throw new ApiError(404, "Farm not found or you do not have permission to access this farm.");
  return { user, farm };
}
