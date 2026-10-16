/**
 * Framework-free error and validation helpers, shared by API routes, the worker and the
 * WebSocket server (which run outside Next.js and can't import next/* modules).
 */
import { ZodError, type ZodType } from "zod";

/**
 * Every error response has one shape:
 *   { "error": { "code": "VALIDATION_ERROR", "message": "...", "fields": { "email": "..." } } }
 * `fields` is present only for validation errors, keyed by input field name.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
    public headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export function zodFields(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "body";
    fields[key] ??= issue.message;
  }
  return fields;
}

/** Validate already-parsed input, throwing a 400 with per-field messages. */
export function validate<T>(schema: ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw new ApiError(400, "VALIDATION_ERROR", "Please fix the highlighted fields.", zodFields(result.error));
  return result.data;
}

/** Parse a JSON body against a zod schema. */
export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
  return validate(schema, raw);
}

export function notFound(what: string): ApiError {
  return new ApiError(404, "NOT_FOUND", `${what} not found.`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assertUuid(value: string, what: string): string {
  if (!UUID.test(value)) throw notFound(what);
  return value;
}
