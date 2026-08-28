import { chmod, mkdir, writeFile } from "node:fs/promises"

export async function prepareKeycloakImportRoot(directory) {
  await mkdir(directory, { mode: 0o755, recursive: true })
  await chmod(directory, 0o755)
}

export async function writeKeycloakRealmImport(path, contents) {
  await writeFile(path, contents, { mode: 0o644 })
  await chmod(path, 0o644)
}
