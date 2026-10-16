"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { LiveEvent } from "./types";

/**
 * One shared live connection per tab (database change feed). Components subscribe with a
 * filter; the connection opens on the first subscriber and closes with the last.
 *
 * Transport: a WebSocket to NEXT_PUBLIC_REALTIME_URL when configured (e.g. "/ws" behind
 * the gateway), reconnecting with exponential backoff + jitter. If the socket can't be
 * established after a few tries (proxy without upgrade support, server down), it falls
 * back to Server-Sent Events at /api/events, which reconnect on their own.
 */
type Listener = (event: LiveEvent) => void;
const listeners = new Set<Listener>();
const statusListeners = new Set<(connected: boolean) => void>();
let connected = false;
let source: EventSource | null = null;
let socket: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let wsFailures = 0;
const WS_MAX_FAILURES = 3;

function setConnected(value: boolean) {
  connected = value;
  for (const l of statusListeners) l(value);
}

function dispatch(raw: string) {
  let event: LiveEvent;
  try {
    event = JSON.parse(raw) as LiveEvent;
  } catch {
    return;
  }
  for (const l of listeners) l(event);
}

function realtimeUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_REALTIME_URL;
  if (!configured || typeof window === "undefined" || typeof WebSocket === "undefined") return null;
  if (/^wss?:\/\//.test(configured)) return configured;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${configured.startsWith("/") ? "" : "/"}${configured}`;
}

function openSse() {
  if (source) return;
  source = new EventSource("/api/events");
  source.addEventListener("ready", () => setConnected(true));
  source.addEventListener("change", (message) => dispatch((message as MessageEvent<string>).data));
  source.onerror = () => setConnected(false);
}

function openSocket(url: string) {
  const ws = new WebSocket(url, "surette.v1");
  socket = ws;
  ws.onmessage = (message) => {
    const data = typeof message.data === "string" ? message.data : "";
    if (data.includes('"type":"ready"')) {
      wsFailures = 0;
      setConnected(true);
      return;
    }
    if (data.includes('"type":"change"')) dispatch(data);
  };
  ws.onclose = () => {
    if (socket !== ws) return; // closed on purpose
    socket = null;
    setConnected(false);
    if (listeners.size === 0) return;
    wsFailures++;
    if (wsFailures >= WS_MAX_FAILURES) return openSse(); // degrade gracefully
    const delay = Math.min(30_000, 1_000 * 2 ** wsFailures) * (0.8 + Math.random() * 0.4);
    retryTimer = setTimeout(() => open(), delay);
  };
}

function open() {
  if (source || socket || typeof window === "undefined") return;
  const url = wsFailures < WS_MAX_FAILURES ? realtimeUrl() : null;
  if (url) openSocket(url);
  else openSse();
}

function close() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  source?.close();
  source = null;
  const ws = socket;
  socket = null;
  ws?.close(1000);
  setConnected(false);
}

/** Call `onEvent` for every live change matching `filter`. The latest callbacks are always used. */
export function useLiveEvents(onEvent: Listener, filter?: (event: LiveEvent) => boolean) {
  const handler = useRef(onEvent);
  const predicate = useRef(filter);
  useEffect(() => {
    handler.current = onEvent;
    predicate.current = filter;
  });
  useEffect(() => {
    const listener: Listener = (event) => {
      if (!predicate.current || predicate.current(event)) handler.current(event);
    };
    listeners.add(listener);
    open();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) close();
    };
  }, []);
}

/** Whether the live connection is up (for a subtle "Live" indicator). Server render: false. */
export function useLiveStatus(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const listener = () => onChange();
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
    () => connected,
    () => false,
  );
}
