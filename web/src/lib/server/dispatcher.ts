import "server-only";
import { breaker } from "./circuit-breaker";
import { ApiError } from "./errors";

/**
 * Bridge to the landlord-dispatcher backend (FastAPI + Supabase + Gemini), which
 * triages tenant maintenance messages, audits vendor certificates of insurance
 * and drafts dispatch emails. See integrations/landlord-dispatcher/ for the
 * patch that adds CORS, stricter validation, the compliance feed and the
 * vendor-portal acknowledgement link on that side.
 *
 * Every call has a short timeout and maps outages to a clean 503, so the
 * public website never hangs or errors because the dispatcher is down.
 */

const TIMEOUT_MS = 12_000;

export function dispatcherConfigured(): boolean {
  return Boolean(process.env.DISPATCHER_API_URL?.trim());
}

function baseUrl(): string {
  const url = process.env.DISPATCHER_API_URL?.trim().replace(/\/$/, "");
  if (!url) throw new ApiError(503, "DISPATCHER_NOT_CONFIGURED", "Maintenance requests aren't connected yet. Please call the office.");
  return url;
}

export async function dispatcherFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  const url = `${baseUrl()}${path}`;
  try {
    // 5xx and network errors count against the breaker; 4xx are answers, not outages.
    response = await breaker("dispatcher", { failureThreshold: 4, resetAfterMs: 30_000, timeoutMs: TIMEOUT_MS }).exec(async (signal) => {
      const r = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(init.body !== undefined && { "Content-Type": "application/json" }),
        ...(process.env.DISPATCHER_API_KEY && { "X-Dispatcher-Key": process.env.DISPATCHER_API_KEY }),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal,
      cache: "no-store",
    });
      if (r.status >= 500) throw new Error(`dispatcher returned ${r.status}`);
      return r;
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "DISPATCHER_UNAVAILABLE", "The maintenance service is temporarily unavailable. For emergencies, call the office.");
  }

  const data = (await response.json().catch(() => null)) as
    | (T & { detail?: unknown; error?: { code?: string; message?: string; fields?: Record<string, string> } })
    | null;
  if (!response.ok) {
    if (response.status === 400 || response.status === 422) {
      const fields = data?.error?.fields ?? {};
      throw new ApiError(response.status, data?.error?.code ?? "VALIDATION_ERROR", data?.error?.message ?? "Please check the form.", fields);
    }
    if (response.status === 404) throw new ApiError(404, "NOT_FOUND", data?.error?.message ?? "Not found.");
    if (response.status === 403 || response.status === 401) {
      throw new ApiError(502, "DISPATCHER_AUTH", "This site isn't authorized with the maintenance service.");
    }
    throw new ApiError(503, "DISPATCHER_UNAVAILABLE", "The maintenance service is temporarily unavailable. For emergencies, call the office.");
  }
  return data as T;
}

export interface TenantAlertResult {
  ticket_ref: string;
  triage: { trade_required: string; urgency: "Emergency" | "Standard"; clean_summary: string };
  vendor: { name?: string; is_mock?: boolean };
}

export type ComplianceStatus = "Compliant" | "Expiring" | "Expired" | "Missing COI" | "Inactive";

export interface VendorCompliance {
  id: string | null;
  name: string;
  trade: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  insurance_expiry: string | null;
  days_until_expiry: number | null;
  status: ComplianceStatus;
}
