# SGLang inference delivery contract

This directory separates the fixed Core Appliance from delivery-specific
inference capacity. The Product source selects SGLang as the v1 inference
engine and locks its upstream source identity. It does not select a customer
GPU, model, context, replica count, or performance claim.

`delivery-profile.schema.json` is the credential-free contract for one
inference delivery. Each instantiated profile binds exact engine and model
artifacts, topology, launch arguments, private routes, probes, capacity
evidence, and rollback identity. A hardware or model change creates a new
profile revision without changing Product source.

The checked-in fixtures are synthetic parser and renderer controls. They are
inactive, unmeasured, and not supported hardware declarations. Only an exact
profile in the `ACTIVE_QUALIFIED` lifecycle state, with active delivery,
matching qualification evidence, measured capacity, and an unexpired
measurement window, renders an `ACTIVE_MEASURED` capability advertisement. The
BFF intersects those advertisements with LiteLLM's read-only `/model/info`
projection before any Key can use an alias.

An `INTERNAL_TEST_ONLY` profile may use the separate
`ACTIVE_MEASURED_INTERNAL_TEST` lifecycle without making a production-capacity
claim. The BFF rejects that scope unless the lab-only
`INFERENCE_ALLOW_INTERNAL_TEST_PROFILES=true` switch is set explicitly. This
switch is forbidden in a production delivery and does not qualify the hardware.

The rendered advertisements are credential-free runtime inputs. Commissioning
places one canonical JSON file per admitted alias in a bounded directory,
replaces that directory atomically, and mounts it read-only at the BFF path
configured by `INFERENCE_MODEL_ADMISSION_DIR`. Inactive, unmeasured, expired,
malformed, duplicate, or LiteLLM-inconsistent inputs fail closed.

## Fixed boundaries

- SGLang is the only v1 inference engine. vLLM is excluded.
- SGLang listens only on the private inference plane. LiteLLM is the sole
  inference caller. Prometheus may read only the private metrics route.
- The Product edge, Console, Application credentials, audit fields, and public
  API remain identical across delivery profiles.
- Request logging, request-body tracing, crash dumps containing workload
  content, silent model substitution, and hosted fallback are prohibited.
- Full model weights live with the inference profile or approved signed media,
  never on the Core backup target.
- This source package performs no deployment and makes no runtime
  qualification claim.

## Source validation

```text
node infra/inference/validate-profile.mjs
node --test infra/inference/*.test.mjs
```
