/**
 * The analytics event allow-list. The collector accepts only these event types, and
 * only these properties for each (anything else is silently dropped). Properties are
 * small, non-sensitive descriptors — never form contents, names, emails or phone numbers.
 */
export type EventCategory = "navigation" | "engagement" | "discovery" | "conversion";

type PropRule = { kind: "string"; max: number; pattern?: RegExp } | { kind: "number"; min: number; max: number } | { kind: "boolean" } | { kind: "uuid" };

const s = (max = 40, pattern?: RegExp): PropRule => ({ kind: "string", max, pattern });
const n = (min: number, max: number): PropRule => ({ kind: "number", min, max });
const b: PropRule = { kind: "boolean" };
const id: PropRule = { kind: "uuid" };
const slug = /^[a-z0-9_-]{1,60}$/i;

export const EVENT_RULES: Record<string, { category: EventCategory; props: Record<string, PropRule>; label: string }> = {
  session_start: { category: "navigation", props: {}, label: "Session start" },
  page_view: { category: "navigation", props: { title: s(80), page_type: s(30, slug) }, label: "Page view" },
  outbound_click: { category: "navigation", props: { domain: s(120, /^[a-z0-9.-]+$/i) }, label: "Outbound link" },
  scroll_depth: { category: "engagement", props: { depth: n(0, 100) }, label: "Scroll depth" },
  page_engagement: { category: "engagement", props: { seconds: n(0, 1800) }, label: "Engaged time" },
  cta_click: { category: "engagement", props: { cta: s(60, slug) }, label: "Call to action" },
  assistant_open: { category: "engagement", props: { surface: s(30, slug) }, label: "AI assistant opened" },
  assistant_message: { category: "engagement", props: { intent: s(30, slug), results: n(0, 200) }, label: "AI assistant message" },
  dual_move_calculate: { category: "engagement", props: { scenarios: n(0, 10) }, label: "Dual-Move calculation" },
  market_view: { category: "engagement", props: { metric: s(40, slug) }, label: "Market dashboard" },
  search_submit: { category: "discovery", props: { surface: s(30, slug), fields_used: n(0, 20), has_city: b, price_band: s(20, /^[a-z0-9_]{1,20}$/i), min_beds: s(5, /^[a-z0-9]{1,5}$/i) }, label: "Search" },
  filter_change: { category: "discovery", props: { filter: s(40, slug), value: s(40, /^[a-z0-9 _.$+-]{1,40}$/i) }, label: "Filter" },
  sort_change: { category: "discovery", props: { sort: s(30, slug) }, label: "Sort" },
  listing_index_view: { category: "discovery", props: { results: n(0, 500) }, label: "Results viewed" },
  property_card_click: { category: "discovery", props: { property_id: id }, label: "Property card click" },
  property_view: { category: "discovery", props: { property_id: id }, label: "Property view" },
  property_save: { category: "discovery", props: { property_id: id, saved: b }, label: "Save / favorite" },
  property_compare: { category: "discovery", props: { count: n(0, 10) }, label: "Comparison" },
  gallery_open: { category: "discovery", props: { property_id: id }, label: "Gallery opened" },
  map_layer_toggle: { category: "discovery", props: { layer: s(20, slug), on: b }, label: "Map layer" },
  agent_profile_view: { category: "conversion", props: { agent_id: id }, label: "Agent profile view" },
  agent_profile_click: { category: "conversion", props: { agent_id: id }, label: "Agent profile click" },
  contact_page_view: { category: "conversion", props: {}, label: "Contact page view" },
  phone_click: { category: "conversion", props: {}, label: "Phone link" },
  email_click: { category: "conversion", props: {}, label: "Email link" },
  form_start: { category: "conversion", props: { form: s(40, slug) }, label: "Form started" },
  form_submit_attempt: { category: "conversion", props: { form: s(40, slug) }, label: "Form submit attempt" },
  contact_submit: { category: "conversion", props: { source: s(30, slug) }, label: "Contact submitted" },
  showing_request_start: { category: "conversion", props: { property_id: id }, label: "Showing request started" },
  showing_request_submit: { category: "conversion", props: { property_id: id, source: s(30, slug) }, label: "Showing requested" },
  newsletter_signup: { category: "conversion", props: {}, label: "Newsletter sign-up" },
  account_signup: { category: "conversion", props: {}, label: "Account created" },
};

/** Funnel stages (session-based). A session counts for a stage if it fired any of its events. */
export const FUNNEL_STAGES: { key: string; label: string; events: string[] }[] = [
  { key: "visit", label: "Website visit", events: ["page_view"] },
  { key: "search", label: "Property search", events: ["search_submit", "filter_change", "listing_index_view"] },
  { key: "detail", label: "Property detail view", events: ["property_view"] },
  { key: "contact_action", label: "Contact action", events: ["phone_click", "email_click", "form_start", "showing_request_start", "assistant_open", "contact_page_view", "agent_profile_view"] },
  { key: "conversion", label: "Contact submitted / showing requested", events: ["contact_submit", "showing_request_submit"] },
];

export const CONVERSION_EVENTS = ["contact_submit", "showing_request_submit"];

/** Keep only allow-listed properties for `type`, coerced to their rule (strings trimmed/matched, numbers clamped). */
export function cleanProps(type: string, raw: Record<string, unknown> | undefined): { props: Record<string, string | number | boolean>; propertyId: string | null } {
  const rules = EVENT_RULES[type].props;
  const props: Record<string, string | number | boolean> = {};
  let propertyId: string | null = null;
  for (const [key, rule] of Object.entries(rules)) {
    const value = raw?.[key];
    if (value === undefined || value === null) continue;
    if (rule.kind === "string" && typeof value === "string") {
      const v = value.trim().slice(0, rule.max);
      if (v && (!rule.pattern || rule.pattern.test(v))) props[key] = v;
    } else if (rule.kind === "number" && typeof value === "number" && Number.isFinite(value)) {
      props[key] = Math.min(rule.max, Math.max(rule.min, Math.round(value)));
    } else if (rule.kind === "boolean" && typeof value === "boolean") {
      props[key] = value;
    } else if (rule.kind === "uuid" && typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)) {
      props[key] = value.toLowerCase();
      if (key === "property_id") propertyId = value.toLowerCase();
    }
  }
  return { props, propertyId };
}
