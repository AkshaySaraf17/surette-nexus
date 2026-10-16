"use client";

import type { ApiErrorBody } from "./types";

/** Error carrying the server's code and per-field messages, so forms can show them inline. */
export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

/** Fetch JSON from our API (same origin; the session cookie rides along). */
export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? "GET",
      headers: { Accept: "application/json", ...(init.body !== undefined && { "Content-Type": "application/json" }) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: "same-origin",
      signal: init.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiClientError(0, "NETWORK_ERROR", "You appear to be offline. Check your connection and try again.");
  }
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      data?.error?.code ?? "HTTP_ERROR",
      data?.error?.message ?? `Request failed (${response.status}).`,
      data?.error?.fields,
    );
  }
  return data as T;
}
