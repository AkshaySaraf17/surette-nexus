import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request context (request id, route, viewer) carried through async calls, so log
 * lines and outbound calls can be correlated without passing ids everywhere.
 * Works in API routes, the worker and the WebSocket server alike.
 */
export interface RequestContext {
  requestId: string;
  route?: string;
  userId?: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

const REQUEST_ID = /^[A-Za-z0-9_.:-]{8,128}$/;
/** Use the gateway's X-Request-Id when it looks sane; otherwise mint one. */
export function requestIdFrom(headers: Headers): string {
  const incoming = headers.get("x-request-id");
  return incoming && REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
}
