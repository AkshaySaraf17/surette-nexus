/*!
 * Surette Analytics SDK v1.0.0 — first-party, consent-aware website analytics.
 * MIT License. No cookies, no fingerprinting, no cross-site tracking, no form contents.
 *
 * Install (async, never blocks the page):
 *   <script async src="https://YOUR-APP/sdk/surette-analytics.js"
 *           data-project="nexus-site"
 *           data-endpoint="https://YOUR-APP/api/analytics/collect"
 *           data-consent-mode="opt-in"></script>
 *
 * Consent modes
 *   opt-in  (default) nothing is sent until SuretteAnalytics.consent("granted").
 *   opt-out events are sent with a per-tab session id only; a persistent pseudonymous
 *           visitor id is created only after consent("granted"). consent("denied") stops everything.
 * Global Privacy Control / Do Not Track are honoured as "denied" unless the visitor
 * explicitly grants consent on this site.
 *
 * Public API: SuretteAnalytics.track(type, props) · .consent("granted"|"denied") ·
 *             .getConsent() · .optOut() · .page() · .flush()
 */
(function (window, document) {
  "use strict";
  if (!window || window.SuretteAnalytics && window.SuretteAnalytics.version) return;

  var script = document.currentScript || document.querySelector("script[data-project][src*='surette-analytics']");
  var cfg = window.SuretteAnalyticsConfig || {};
  function attr(name) { return script ? script.getAttribute("data-" + name) : null; }

  var PROJECT = cfg.project || attr("project");
  var ENDPOINT = cfg.endpoint || attr("endpoint") || "/api/analytics/collect";
  var MODE = (cfg.consentMode || attr("consent-mode") || "opt-in") === "opt-out" ? "opt-out" : "opt-in";
  var DEBUG = cfg.debug || attr("debug") === "true";
  var SESSION_TIMEOUT_MS = 30 * 60 * 1000;
  var FLUSH_MS = 4000;
  var MAX_BATCH = 20;
  var KEYS = { consent: "sa_consent", visitor: "sa_vid", session: "sa_sid", utm: "sa_utm" };

  var queue = [];
  var timer = null;
  var sentIds = {};
  var scrollMarks = {};
  var visibleSince = null;
  var visibleMs = 0;
  var currentPath = null;

  function log() { if (DEBUG && window.console) console.log.apply(console, ["[surette-analytics]"].concat([].slice.call(arguments))); }

  // ---- storage helpers (every access guarded: private mode / blocked storage) ----
  function get(store, key) { try { return window[store].getItem(key); } catch (e) { return null; } }
  function set(store, key, value) { try { window[store].setItem(key, value); } catch (e) { /* ignore */ } }
  function del(store, key) { try { window[store].removeItem(key); } catch (e) { /* ignore */ } }

  function randomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    var s = ""; for (var i = 0; i < 24; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(Math.random() * 36));
    return s;
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = []; for (var i = 0; i < 16; i++) b.push(Math.floor(Math.random() * 256));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = b.map(function (x) { return (x + 256).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  // ---- consent ----
  function privacySignal() { return navigator.globalPrivacyControl === true || navigator.doNotTrack === "1" || window.doNotTrack === "1"; }
  function consentState() {
    var stored = get("localStorage", KEYS.consent);
    if (stored === "granted" || stored === "denied") return stored;
    if (privacySignal()) return "denied";
    return "unset";
  }
  function canSend() {
    var c = consentState();
    if (c === "denied") return false;
    if (c === "granted") return true;
    return MODE === "opt-out";
  }

  // ---- identifiers ----
  function session() {
    var now = Date.now();
    var raw = get("sessionStorage", KEYS.session);
    var s = null;
    try { s = raw ? JSON.parse(raw) : null; } catch (e) { s = null; }
    var fresh = !s || now - s.last > SESSION_TIMEOUT_MS;
    if (fresh) s = { id: randomId(), last: now, start: now };
    s.last = now;
    set("sessionStorage", KEYS.session, JSON.stringify(s));
    return { id: s.id, fresh: fresh };
  }
  function visitorId() {
    if (consentState() !== "granted") return null;
    var v = get("localStorage", KEYS.visitor);
    if (!v || !/^[a-z0-9]{8,40}$/.test(v)) { v = randomId(); set("localStorage", KEYS.visitor, v); }
    return v;
  }

  // ---- context ----
  function utm() {
    var stored = get("sessionStorage", KEYS.utm);
    if (stored) { try { return JSON.parse(stored); } catch (e) { /* fall through */ } }
    var out = {};
    try {
      var p = new URLSearchParams(location.search);
      ["source", "medium", "campaign", "content", "term"].forEach(function (k) {
        var v = p.get("utm_" + k); if (v) out[k] = v.slice(0, 80);
      });
    } catch (e) { /* old browser */ }
    set("sessionStorage", KEYS.utm, JSON.stringify(out));
    return out;
  }
  function referrerDomain() {
    try {
      if (!document.referrer) return null;
      var host = new URL(document.referrer).hostname;
      return host === location.hostname ? null : host.slice(0, 120);
    } catch (e) { return null; }
  }
  function device() { var w = window.innerWidth || 1024; return w < 768 ? "mobile" : w < 1100 ? "tablet" : "desktop"; }
  function path() { return (location.pathname || "/").slice(0, 300); }

  // ---- queue & delivery ----
  function enqueue(type, props) {
    if (!PROJECT) { log("missing data-project"); return; }
    if (!canSend()) { log("not sent (consent)", type); return; }
    var s = session();
    if (s.fresh && type !== "session_start") enqueue("session_start", {});
    var ev = {
      event_id: uuid(),
      type: type,
      occurred_at: new Date().toISOString(),
      session_id: s.id,
      visitor_id: visitorId(),
      path: path(),
      referrer_domain: referrerDomain(),
      utm: utm(),
      device: device(),
      props: props || {}
    };
    queue.push(ev);
    log("queued", type, props);
    if (queue.length >= MAX_BATCH) flush(); else schedule();
  }
  function schedule() { if (!timer) timer = setTimeout(function () { timer = null; flush(); }, FLUSH_MS); }

  function flush(useBeacon) {
    if (!queue.length) return;
    var batch = queue.splice(0, MAX_BATCH).filter(function (e) { if (sentIds[e.event_id]) return false; sentIds[e.event_id] = 1; return true; });
    if (!batch.length) return;
    var body = JSON.stringify({ project: PROJECT, consent: consentState(), events: batch });
    try {
      if (useBeacon && navigator.sendBeacon) {
        if (navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain" }))) return;
      }
      if (window.fetch) {
        fetch(ENDPOINT, { method: "POST", body: body, keepalive: true, mode: "cors", credentials: "omit", headers: { "Content-Type": "text/plain" } })
          .catch(function () { log("delivery failed; events dropped"); });
      }
    } catch (e) { log("delivery error", e); }
    if (queue.length) schedule();
  }

  // ---- automatic events ----
  function pageView() {
    var p = path();
    if (p === currentPath) return;
    if (currentPath !== null) endEngagement();
    currentPath = p;
    scrollMarks = {};
    visibleMs = 0;
    visibleSince = document.visibilityState === "visible" ? Date.now() : null;
    var meta = document.querySelector("meta[name='sa-property-id']");
    var page = document.querySelector("meta[name='sa-page-type']");
    enqueue("page_view", { title: (document.title || "").slice(0, 80), page_type: page ? page.getAttribute("content") : undefined });
    if (meta && meta.getAttribute("content")) enqueue("property_view", { property_id: meta.getAttribute("content") });
  }
  function endEngagement() {
    if (visibleSince) { visibleMs += Date.now() - visibleSince; visibleSince = null; }
    var seconds = Math.round(visibleMs / 1000);
    if (seconds >= 1 && currentPath) enqueue("page_engagement", { seconds: Math.min(seconds, 1800) });
    visibleMs = 0;
  }
  function onScroll() {
    var doc = document.documentElement;
    var max = (doc.scrollHeight || 0) - window.innerHeight;
    if (max <= 0) return;
    var pct = Math.round(((window.scrollY || doc.scrollTop) / max) * 100);
    [25, 50, 75, 90].forEach(function (mark) {
      if (pct >= mark && !scrollMarks[mark]) { scrollMarks[mark] = true; enqueue("scroll_depth", { depth: mark }); }
    });
  }
  function closest(el, selector) {
    while (el && el.nodeType === 1) { if (el.matches && el.matches(selector)) return el; el = el.parentElement; }
    return null;
  }
  function onClick(e) {
    var t = e.target;
    var card = closest(t, "[data-sa-property-card]");
    if (card) enqueue("property_card_click", { property_id: card.getAttribute("data-sa-property-card") });
    var cta = closest(t, "[data-sa-cta]");
    if (cta) enqueue("cta_click", { cta: (cta.getAttribute("data-sa-cta") || "").slice(0, 60) });
    var agent = closest(t, "[data-sa-agent]");
    if (agent) enqueue("agent_profile_click", { agent_id: agent.getAttribute("data-sa-agent") });
    var a = closest(t, "a[href]");
    if (!a) return;
    var href = a.getAttribute("href") || "";
    if (/^tel:/i.test(href)) enqueue("phone_click", {});
    else if (/^mailto:/i.test(href)) enqueue("email_click", {});
    else {
      try {
        var u = new URL(href, location.href);
        if (/^https?:$/.test(u.protocol) && u.hostname !== location.hostname) enqueue("outbound_click", { domain: u.hostname.slice(0, 120) });
      } catch (err) { /* ignore */ }
    }
  }
  var startedForms = {};
  function formName(form) { return (form.getAttribute("data-sa-form") || "").slice(0, 40); }
  function onFocusIn(e) {
    var form = closest(e.target, "form[data-sa-form]");
    if (!form) return;
    var name = formName(form);
    if (startedForms[name + currentPath]) return;
    startedForms[name + currentPath] = true;
    enqueue("form_start", { form: name });
  }
  function onSubmit(e) {
    var form = e.target;
    if (!form || !form.matches) return;
    if (form.matches("[role='search'], form[data-sa-search]")) {
      // Only which fields were used — never what was typed.
      var used = 0;
      [].forEach.call(form.elements, function (el) { if (el.name && el.value && el.type !== "password") used++; });
      enqueue("search_submit", { fields_used: used, surface: (form.getAttribute("data-sa-search") || "site").slice(0, 30) });
    }
    if (form.matches("form[data-sa-form]")) enqueue("form_submit_attempt", { form: formName(form) });
  }
  function onChange(e) {
    var el = closest(e.target, "[data-sa-filter]");
    if (!el) return;
    // The page decides the reported value via data-sa-value (e.g. a price band), never the raw input.
    enqueue("filter_change", { filter: el.getAttribute("data-sa-filter").slice(0, 40), value: (el.getAttribute("data-sa-value") || "").slice(0, 40) || undefined });
  }

  function hookHistory() {
    ["pushState", "replaceState"].forEach(function (fn) {
      var orig = history[fn];
      if (!orig) return;
      history[fn] = function () { var r = orig.apply(this, arguments); setTimeout(pageView, 0); return r; };
    });
    window.addEventListener("popstate", function () { setTimeout(pageView, 0); });
  }

  function start() {
    hookHistory();
    document.addEventListener("click", onClick, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("change", onChange, true);
    var scrollTimer = null;
    window.addEventListener("scroll", function () { if (!scrollTimer) scrollTimer = setTimeout(function () { scrollTimer = null; onScroll(); }, 250); }, { passive: true });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { endEngagement(); flush(true); }
      else visibleSince = Date.now();
    });
    window.addEventListener("pagehide", function () { endEngagement(); flush(true); });
    pageView();
  }

  window.SuretteAnalytics = {
    version: "1.0.0",
    track: function (type, props) {
      if (typeof type !== "string" || !/^[a-z_]{3,40}$/.test(type)) return;
      var clean = {};
      if (props && typeof props === "object") {
        Object.keys(props).slice(0, 12).forEach(function (k) {
          var v = props[k];
          if (typeof v === "string") clean[k] = v.slice(0, 80);
          else if (typeof v === "number" && isFinite(v)) clean[k] = v;
          else if (typeof v === "boolean") clean[k] = v;
        });
      }
      enqueue(type, clean);
    },
    page: pageView,
    flush: function () { flush(false); },
    getConsent: consentState,
    consent: function (state) {
      if (state !== "granted" && state !== "denied") return;
      set("localStorage", KEYS.consent, state);
      if (state === "denied") { queue = []; del("localStorage", KEYS.visitor); del("sessionStorage", KEYS.session); del("sessionStorage", KEYS.utm); }
      else if (currentPath === null) start();
      else { currentPath = null; pageView(); }
      try { window.dispatchEvent(new CustomEvent("surette-analytics:consent", { detail: state })); } catch (e) { /* old browser */ }
    },
    optOut: function () { window.SuretteAnalytics.consent("denied"); }
  };

  // Calls made before the script loaded: window.SuretteAnalyticsQueue = [["track", "cta_click", {...}]]
  var early = window.SuretteAnalyticsQueue || [];

  function boot() {
    try {
      if (canSend()) start();
      early.forEach(function (c) { var fn = window.SuretteAnalytics[c[0]]; if (typeof fn === "function") fn.apply(null, c.slice(1)); });
    } catch (e) { log("init error", e); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})(typeof window !== "undefined" ? window : null, typeof document !== "undefined" ? document : null);
