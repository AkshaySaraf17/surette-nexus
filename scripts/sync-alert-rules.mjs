// Regenerates deploy/k8s/monitoring/prometheus-rule.yaml (and copies the Grafana dashboard) from deploy/observability/prometheus/alerts.yml
// so docker-compose Prometheus and Kubernetes (Prometheus Operator) share one set of alert rules.
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const yaml = createRequire(path.join(root, "web/package.json"))("js-yaml");
const rules = yaml.load(readFileSync(path.join(root, "deploy/observability/prometheus/alerts.yml"), "utf8"));
const doc = {
  apiVersion: "monitoring.coreos.com/v1",
  kind: "PrometheusRule",
  metadata: { name: "surette-alerts", labels: { release: "kube-prometheus-stack" } },
  spec: { groups: rules.groups },
};
const header = "# GENERATED from deploy/observability/prometheus/alerts.yml — edit that file, then run\n#   node scripts/sync-alert-rules.mjs\n# (web/tests/deploy-config.test.ts fails if the two drift apart.)\n";
writeFileSync(path.join(root, "deploy/k8s/monitoring/prometheus-rule.yaml"), header + yaml.dump(doc, { lineWidth: 200, noRefs: true }));
copyFileSync(
  path.join(root, "deploy/observability/grafana/dashboards/surette-overview.json"),
  path.join(root, "deploy/k8s/monitoring/surette-overview.json"),
);
console.log("prometheus-rule.yaml and the Grafana dashboard copy updated");
