#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const directory = dirname(fileURLToPath(import.meta.url))
const result = spawnSync(
  "python3",
  [resolve(directory, "resolve-egress-hosts.py"), ...process.argv.slice(2)],
  { stdio: "inherit" },
)

if (result.error) throw result.error
process.exitCode = result.status ?? 1
