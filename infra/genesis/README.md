# Product source Genesis

`source-classification.json` is the reviewed, explicit disposition of every
tracked Product path. Validation fails if a path is missing, duplicated,
unsafe or assigned an unknown class.

`generate-genesis-source.mjs` reads one exact Git commit, verifies the
classification, scans included paths and text, and derives a filtered Git tree
and deterministic tar archive. It records the input commit and tree separately
from the generated tree and archive digest.

The same check recognizes a filtered snapshot by its exact included path set.
That lets the documented repository gates run after the source tree is added on
top of the preserved internal-repository placeholder commit. The snapshot never
needs the excluded source objects or a GitHub-only historical base ref.

`source-transforms.json` declares the one reviewed normalization. It replaces
the generated snapshot's root package manifest with
`snapshot-root-package.json`, removing only commands whose historical or lab
inputs are intentionally excluded. The authoritative source package retains
the protected base-ref and full guardrail chain. Both input and output Git
objects and the transform-policy hash are bound into the generated manifest.

The generator never changes source history, creates a release or pushes a
remote. Excluded files remain in the source repository and its history.

To prepare an updated classification after reviewing new paths:

```sh
node infra/genesis/update-source-classification.mjs --write
```

Review the complete manifest diff before committing it.

To create a new external package directory:

```sh
node infra/genesis/generate-genesis-source.mjs \
  --source-ref HEAD \
  --output-dir /absolute/new/output-directory
```

The output path must not exist, must not be a symbolic link and must be outside
the source repository. The generator creates a mode-`0600` archive, excluded
path report and manifest. It never overwrites an existing path.
