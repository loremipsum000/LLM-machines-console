import assert from "node:assert/strict"
import {
  chmod,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { loadFounderIdentitySecret } from "../pre-genesis/founder-identity-secret.mjs"

const validDocument = {
  identities: {
    admin: {
      password: "fixture-admin-password",
      role: "admin",
      username: "admin",
    },
    operator: {
      password: "fixture-operator-password",
      role: "operator",
      username: "operator",
    },
  },
  rotationRequiredBeforeBroaderAccess: true,
  schemaVersion: 1,
}

test("founder identity secret accepts only the exact restrictive contract", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "llmm-founder-identities-")),
  )
  const path = join(root, "identities.json")
  try {
    await writeFile(path, `${JSON.stringify(validDocument)}\n`, { mode: 0o600 })
    const loaded = await loadFounderIdentitySecret(path)
    assert.deepEqual(loaded, validDocument)

    await chmod(path, 0o640)
    await assert.rejects(loadFounderIdentitySecret(path), /mode 0600/)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("founder identity secret rejects links, caller-selected names, and missing rotation", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "llmm-founder-identities-")),
  )
  const path = join(root, "identities.json")
  const link = join(root, "identities-link.json")
  try {
    await writeFile(path, `${JSON.stringify(validDocument)}\n`, { mode: 0o600 })
    await symlink(path, link)
    await assert.rejects(loadFounderIdentitySecret(link), /regular file/)

    for (const mutation of [
      {
        ...validDocument,
        identities: {
          ...validDocument.identities,
          admin: { ...validDocument.identities.admin, username: "other" },
        },
      },
      { ...validDocument, rotationRequiredBeforeBroaderAccess: false },
      { ...validDocument, unexpected: true },
    ]) {
      await writeFile(path, `${JSON.stringify(mutation)}\n`, { mode: 0o600 })
      await assert.rejects(loadFounderIdentitySecret(path))
    }
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
