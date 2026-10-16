import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Surette Nexus API client for the team app.
 *
 * Talks to the same Next.js API as the website (web/), authenticating with the
 * bearer token from /api/auth/login. Shapes mirror web/src/lib/types.ts — keep
 * them in sync. Every money field is an integer number of cents.
 */

export type Role = "admin" | "agent" | "client";
export type ListingStatus = "draft" | "active" | "pending" | "sold" | "off_market";
export type ShowingStatus = "requested" | "confirmed" | "completed" | "cancelled";

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  teamId: string | null;
}

export interface Rendition {
  url: string;
  width: number;
  height: number;
}

export interface ListingCard {
  id: string;
  slug: string;
  status: ListingStatus;
  listingType: "sale" | "rent";
  title: string;
  headline: string | null;
  addressLine: string;
  city: string;
  state: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
  priceCents: number;
  bedrooms: number;
  fullBaths: number;
  halfBaths: number;
  livingAreaSqft: number | null;
  lotSizeSqft: number | null;
  yearBuilt: number | null;
  isFeatured: boolean;
  updatedAt: string;
  cover: { url: string; width: number; height: number; blurDataUrl: string | null; variants: Partial<Record<"sm" | "md" | "xl", Rendition>> } | null;
  mediaCount: number;
}

export interface ListingDetail extends ListingCard {
  description: string;
  hoaMonthlyCents: number;
  taxAnnualCents: number;
  amenities: string[];
  structuralFeatures: Record<string, string>;
  media: { id: string; url: string; alt: string; isCover: boolean; variants: Partial<Record<"sm" | "md" | "xl", Rendition>> }[];
}

export interface Showing {
  id: string;
  propertyTitle: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  startsAt: string;
  endsAt: string;
  status: ShowingStatus;
  source: string;
  notes: string | null;
}

/** Listing fields sent as the `metadata` part of the multipart upload. */
export interface ListingMetadata {
  title: string;
  headline: string | null;
  description: string;
  addressLine: string;
  city: string;
  state: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
  status: ListingStatus;
  listingType: "sale" | "rent";
  priceCents: number;
  hoaMonthlyCents: number;
  taxAnnualCents: number;
  bedrooms: number;
  fullBaths: number;
  halfBaths: number;
  livingAreaSqft: number | null;
  lotSizeSqft: number | null;
  yearBuilt: number | null;
  isFeatured: boolean;
  amenities: string[];
  structuralFeatures: Record<string, string>;
}

export interface UploadPhoto {
  uri: string;
  name: string;
  type: string;
  alt: string;
}

/** Error with the server's code and per-field messages, for inline form errors. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

const API_PORT = 3100;

/**
 * Where the API lives:
 *  1. EXPO_PUBLIC_API_URL (mobile/.env) for a deployed backend
 *  2. In Expo Go, the computer serving the bundle (its LAN IP), port 3100
 *  3. In a browser, the page's own host, port 3100
 */
export function defaultApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  if (host) return `http://${host}:${API_PORT}`;
  if (Platform.OS === "web" && typeof window !== "undefined") return `${window.location.protocol}//${window.location.hostname}:${API_PORT}`;
  return `http://localhost:${API_PORT}`;
}

const TOKEN_KEY = "surette.session";

/** Session token: Keychain / Keystore on devices, localStorage on web. */
export const tokenStore = {
  async get(): Promise<string | null> {
    if (Platform.OS === "web") {
      try {
        return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
      } catch {
        return null;
      }
    }
    return SecureStore.getItemAsync(TOKEN_KEY);
  },
  async set(token: string): Promise<void> {
    if (Platform.OS === "web") {
      try {
        globalThis.localStorage?.setItem(TOKEN_KEY, token);
      } catch {
        // Private browsing: the session just won't survive a reload.
      }
      return;
    }
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  },
  async clear(): Promise<void> {
    if (Platform.OS === "web") {
      try {
        globalThis.localStorage?.removeItem(TOKEN_KEY);
      } catch {
        // ignore
      }
      return;
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  },
};

let baseUrl = defaultApiUrl();
let token: string | null = null;

export const getApiUrl = () => baseUrl;
export const setSessionToken = (next: string | null) => {
  token = next;
};

/** Absolute URL for an API-relative media path (e.g. "/media/listings/…"). */
export const mediaUrl = (path: string) => (path.startsWith("http") ? path : `${baseUrl}${path}`);

const TIMEOUT_MS = 15_000;

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(init.body !== undefined && { "Content-Type": "application/json" }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", `Can't reach the server at ${baseUrl}. Make sure it's running and you're on the same Wi-Fi.`);
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => null)) as (T & { error?: { code: string; message: string; fields?: Record<string, string> } }) | null;
  if (!response.ok) {
    throw new ApiError(response.status, data?.error?.code ?? "HTTP_ERROR", data?.error?.message ?? `Request failed (${response.status}).`, data?.error?.fields);
  }
  return data as T;
}

export const api = {
  login: (email: string, password: string) => request<{ token: string; user: User }>("/api/auth/login", { method: "POST", body: { email, password, audience: "staff" } }),
  me: () => request<{ user: User }>("/api/auth/me"),
  listings: () => request<{ listings: ListingCard[] }>("/api/properties?drafts=1&sort=newest&limit=200"),
  listing: (id: string) => request<{ property: ListingDetail }>(`/api/properties/${id}`),
  updateListing: (id: string, patch: Partial<ListingMetadata>) => request<{ property: ListingDetail }>(`/api/properties/${id}`, { method: "PATCH", body: patch }),
  showings: () => request<{ showings: Showing[] }>("/api/showings"),
  updateShowing: (id: string, status: ShowingStatus) => request<{ showing: Showing }>(`/api/showings/${id}`, { method: "PATCH", body: { status } }),
};

/**
 * Multipart upload to /api/properties/upload — creates a listing (metadata) or adds
 * photos to one (propertyId). React Native streams each file from disk; XHR gives
 * upload progress, which fetch doesn't.
 */
export async function uploadListing(
  input: { propertyId?: string; metadata?: ListingMetadata | Partial<ListingMetadata>; photos: UploadPhoto[]; coverIndex?: number },
  onProgress: (fraction: number) => void,
): Promise<{ property: ListingDetail; uploaded: number }> {
  const form = new FormData();
  if (input.propertyId) form.append("propertyId", input.propertyId);
  if (input.metadata) form.append("metadata", JSON.stringify(input.metadata));
  form.append("alts", JSON.stringify(input.photos.map((p) => p.alt)));
  if (input.coverIndex !== undefined && input.coverIndex >= 0) form.append("coverIndex", String(input.coverIndex));
  for (const p of input.photos) {
    if (Platform.OS === "web") {
      // In a browser the picked image is a blob:/data: URL; send the actual bytes.
      const blob = await (await fetch(p.uri)).blob();
      form.append("files", new File([blob], p.name, { type: p.type }));
    } else {
      // React Native streams { uri, name, type } file descriptors straight from disk.
      form.append("files", { uri: p.uri, name: p.name, type: p.type } as unknown as Blob);
    }
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${baseUrl}/api/properties/upload`);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data: { error?: { code: string; message: string; fields?: Record<string, string> } } | null = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // non-JSON
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as unknown as { property: ListingDetail; uploaded: number });
      else reject(new ApiError(xhr.status, data?.error?.code ?? "UPLOAD_FAILED", data?.error?.message ?? `Upload failed (${xhr.status}).`, data?.error?.fields));
    };
    xhr.onerror = () => reject(new ApiError(0, "NETWORK_ERROR", "The upload was interrupted. Check your connection and try again."));
    xhr.ontimeout = () => reject(new ApiError(0, "TIMEOUT", "The upload took too long. Try fewer photos at once."));
    xhr.timeout = 10 * 60_000;
    xhr.send(form);
  });
}

/** 41067 → "$410.67" */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

/** 125000000 → "$1,250,000" */
export const formatPrice = (cents: number) => `$${Math.floor((cents + 50) / 100).toLocaleString("en-US")}`;
