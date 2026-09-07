import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class ApiError {
  readonly name = "ApiError";
  constructor(public status: number, public message: string) {}
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function fail(error: unknown) {
  if (error instanceof ApiError) return NextResponse.json({ success: false, message: error.message }, { status: error.status });
  if (error instanceof Error && (error.message.includes("Can't reach database server") || error.message.includes("P1001"))) {
    return NextResponse.json({ success: false, message: "Database is unavailable. Start PostgreSQL on localhost:5432, then run the database migration and seed commands." }, { status: 503 });
  }
  if (error && typeof error === "object") {
    const candidate = error as { status?: unknown; message?: unknown; cause?: { status?: unknown } };
    const status = Number(candidate.status ?? candidate.cause?.status);
    if (status >= 400 && status < 600) return NextResponse.json({ success: false, message: String(candidate.message || "Request failed.") }, { status });
  }
  if (error instanceof ZodError) return NextResponse.json({ success: false, message: "Please check the entered information.", errors: error.flatten().fieldErrors }, { status: 400 });
  console.error(error);
  return NextResponse.json({ success: false, message: "Something went wrong. Please try again." }, { status: 500 });
}

export async function body<T>(request: Request, schema: { parse(value: unknown): T }): Promise<T> {
  let value: unknown;
  try { value = await request.json(); } catch { throw new ApiError(400, "A valid JSON body is required."); }
  return schema.parse(value);
}
