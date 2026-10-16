import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static checks on the deployment configuration (no Docker/Kubernetes needed):
 * alert rules are identical for docker-compose and Kubernetes, every alert has a runbook,
 * every Deployment has health probes and resource requests, and the gateway routes the
 * realtime and metrics paths the way the app expects.
 */
const yaml = createRequire(import.meta.url)("js-yaml") as { load(s: string): unknown; loadAll(s: string): unknown[] };
const root = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

type Rule = { alert: string; expr: string; labels: { severity: string }; annotations: { summary: string; runbook: string } };
type Groups = { groups: { name: string; rules: Rule[] }[] };

describe("alerting", () => {
  const compose = yaml.load(read("deploy/observability/prometheus/alerts.yml")) as Groups;
  const k8s = (yaml.load(read("deploy/k8s/monitoring/prometheus-rule.yaml")) as { spec: Groups }).spec;

  it("docker-compose and Kubernetes use the same rules (run scripts/sync-alert-rules.mjs)", () => {
    expect(k8s.groups).toEqual(compose.groups);
    expect(read("deploy/k8s/monitoring/surette-overview.json")).toBe(read("deploy/observability/grafana/dashboards/surette-overview.json"));
  });

  it("every alert has a severity Alertmanager routes, a summary and a runbook section that exists", () => {
    const runbooks = read("docs/runbooks.md");
    const anchors = new Set([...runbooks.matchAll(/^#{2,3} .*\{#([a-z0-9-]+)\}|<a id="([a-z0-9-]+)"><\/a>/gm)].map((m) => m[1] ?? m[2]));
    for (const rule of compose.groups.flatMap((g) => g.rules)) {
      expect(["critical", "warning"]).toContain(rule.labels.severity);
      expect(rule.annotations.summary.length).toBeGreaterThan(10);
      const anchor = rule.annotations.runbook.split("#")[1];
      expect(anchors, `runbook anchor #${anchor} for ${rule.alert}`).toContain(anchor);
    }
  });

  it("alerts only reference metrics the services actually export", () => {
    const exported = read("web/src/lib/server/metrics.ts");
    const appMetrics = ["http_request_duration_seconds", "db_pool_connections", "db_transaction_duration_seconds", "jobs_processed_total", "job_queue_depth", "outbox_lag_seconds", "circuit_breaker_state", "rate_limited_total", "analytics_events_total"];
    for (const m of appMetrics) expect(exported, m).toContain(`"${m}"`);
    const exprs = compose.groups.flatMap((g) => g.rules.map((r) => r.expr)).join("\n");
    for (const m of appMetrics) expect(exprs, m).toContain(m);
  });
});

describe("kubernetes manifests", () => {
  const docs = readdirSync(path.join(root, "deploy/k8s/base"))
    .filter((f) => f.endsWith(".yaml"))
    .flatMap((f) => yaml.loadAll(read(`deploy/k8s/base/${f}`)) as { kind: string; metadata: { name: string }; spec: Record<string, unknown> }[]);

  it("every Deployment has readiness + liveness probes, resource requests and runs as non-root", () => {
    const deployments = docs.filter((d) => d?.kind === "Deployment");
    expect(deployments.map((d) => d.metadata.name).sort()).toEqual(["realtime", "web", "worker"]);
    for (const d of deployments) {
      const pod = (d.spec.template as { spec: { securityContext: { runAsNonRoot: boolean }; containers: Record<string, unknown>[] } }).spec;
      expect(pod.securityContext.runAsNonRoot).toBe(true);
      for (const c of pod.containers) {
        expect(c.readinessProbe, `${d.metadata.name} readiness`).toBeTruthy();
        expect(c.livenessProbe, `${d.metadata.name} liveness`).toBeTruthy();
        expect((c.resources as { requests: object }).requests).toBeTruthy();
      }
    }
  });

  it("web probes hit the app's health endpoints", () => {
    const web = read("deploy/k8s/base/web.yaml");
    expect(web).toContain("/api/health/ready");
    expect(web).toContain("/api/health/live");
  });
});

describe("gateway", () => {
  const nginx = read("deploy/nginx/nginx.conf");
  it("routes /ws to the realtime service with upgrade headers and hides /api/metrics", () => {
    expect(nginx).toMatch(/location = \/ws \{[^}]*proxy_pass http:\/\/realtime;[^}]*Upgrade/);
    expect(nginx).toMatch(/location = \/api\/metrics \{ return 404; \}/);
    expect(nginx).toContain("proxy_set_header X-Real-IP         $remote_addr;");
    expect(nginx).toContain("proxy_hide_header X-Request-Id;");
  });
  it("never retries non-idempotent requests", () => {
    expect(nginx).not.toMatch(/^\s*proxy_next_upstream [^;#]*non_idempotent/m);
    expect(nginx).toMatch(/^\s*proxy_next_upstream error timeout http_502 http_503;/m);
  });
});
