import { describe, expect, it } from "vitest";
import { EVENT_RULES, FUNNEL_STAGES, cleanProps } from "@/lib/analytics-events";

/** Analytics privacy: the collector keeps only allow-listed, non-personal properties. */
describe("analytics property allow-list", () => {
  it("drops unknown keys — e.g. form contents never get stored", () => {
    const { props } = cleanProps("contact_submit", { source: "contact_page", email: "a@b.com", message: "hi", phone: "207" });
    expect(props).toEqual({ source: "contact_page" });
  });
  it("validates patterns, clamps numbers and lowercases ids", () => {
    expect(cleanProps("scroll_depth", { depth: 140 }).props).toEqual({ depth: 100 });
    expect(cleanProps("cta_click", { cta: "<script>" }).props).toEqual({});
    const id = "0F8FAD5B-D9CB-469F-A165-70867728950E";
    const r = cleanProps("property_view", { property_id: id });
    expect(r.propertyId).toBe(id.toLowerCase());
    expect(cleanProps("property_view", { property_id: "not-a-uuid" }).propertyId).toBeNull();
  });
  it("no allow-listed property name looks like personal data", () => {
    for (const rule of Object.values(EVENT_RULES)) for (const key of Object.keys(rule.props)) expect(key).not.toMatch(/email|phone|name|address|message/i);
  });
  it("every funnel event is an allowed event type", () => {
    for (const stage of FUNNEL_STAGES) for (const e of stage.events) expect(EVENT_RULES).toHaveProperty(e);
  });
});
