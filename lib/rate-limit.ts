import { ApiError } from "@/lib/api";

const buckets = new Map<string, { count: number; reset: number }>();
export function rateLimit(key: string, max = 5, windowMs = 60_000) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.reset < now) { buckets.set(key, { count: 1, reset: now + windowMs }); return; }
  if (current.count >= max) throw new ApiError(429, "Too many attempts. Please wait and try again.");
  current.count += 1;
}
