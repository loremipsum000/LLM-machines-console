# Inference Core observability source package

This directory is a static, source-only PR-09 contract. It does not install,
start, expose, or connect Prometheus, Alertmanager, Grafana, exporters, or an
inference runtime. PR-12 owns pinned images, runtime targets, network
placement, credentials, secret-file mounts, and release qualification.

## Product boundary

- Prometheus metrics and alert state retain for 30 days.
- Alertmanager notification and silence state retains for 720 hours.
- The product-owned Grafana datasource, dashboard, and Prometheus rule files
  are locked. Customer Admin can view the baseline; Operator has no native
  Grafana session.
- Admin maps to Grafana Editor. Operator, mixed retained roles, and unknown
  roles are denied by strict role mapping. Grafana Editor can edit all
  non-provisioned Grafana content in the single-customer appliance, not only
  the designated customer folder, and never receives Grafana server-admin.
- `Customer Editable` is an unprovisioned folder created during PR-12
  commissioning. Admin can edit its dashboards; Operator has no native
  Grafana access.
- Alerts protect appliance operations. They do not impose a commercial quota
  or stop a customer from consuming hardware the customer owns.
- Alertmanager has only a local null receiver by default. Customer-owned SMTP
  or webhook delivery requires a later Admin warning acknowledgement, an
  audited Console action, and an explicit egress policy. No destination or
  credential is included here.

## Signals

The baseline consumes normalized, metadata-only metrics. It never stores
prompts, responses, search terms, URLs, request bodies, headers, or tool
arguments and results. Queue depth is represented only by the genuine
`llm_machines_inference_queue_depth` gauge. Concurrent requests are not a
queue-depth substitute. If the runtime cannot supply that gauge, the baseline raises
`LLMMInferenceQueueDepthSignalMissing` instead of fabricating a value.

The operational alerts are:

- `LLMMGpuSaturation`: maximum normalized GPU utilization remains above 95
  percent for 10 minutes.
- `LLMMInferenceFailureRatioHigh`: the five-minute failure ratio exceeds 5
  percent after at least 20 requests in that interval.
- `LLMMInferenceQueueDepthPersisting`: genuine queue depth remains above zero
  for 10 minutes.
- `LLMMInferenceQueueDepthSignalMissing`: the genuine queue signal is absent
  for 10 minutes.

## Source validation

Run the offline validator without network or runtime access:

```text
node infra/observability/validate-profile.mjs
node --test infra/observability/validate-profile.test.mjs
```

The validator rejects checked-in credentials, literal targets, internal
addresses and lab names, unsafe notification receivers, workload-bearing
labels or annotations, mutable baseline provisioning, queue-depth inference,
and unresolved placeholder values outside the exact packaging bindings.
