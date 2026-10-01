import { join } from "node:path"
import { getAgentDir } from "../paths.js"
import { mutateJsonFile, readJsonFile } from "../atomic-write.js"

export type MemorySettings = { recallEnabled: boolean; suggestEnabled: boolean }
const defaults: MemorySettings = { recallEnabled: true, suggestEnabled: true }
const settingsPath = () => join(getAgentDir(), "pi-ui", "memory-settings.json")

export function readMemorySettings(): MemorySettings {
  const raw = readJsonFile<Partial<MemorySettings>>(settingsPath())
  return {
    recallEnabled: typeof raw?.recallEnabled === "boolean" ? raw.recallEnabled : defaults.recallEnabled,
    suggestEnabled: typeof raw?.suggestEnabled === "boolean" ? raw.suggestEnabled : defaults.suggestEnabled,
  }
}

export async function updateMemorySettings(patch: Partial<MemorySettings>): Promise<MemorySettings> {
  await mutateJsonFile<MemorySettings>(settingsPath(), current => ({
    recallEnabled: typeof patch.recallEnabled === "boolean" ? patch.recallEnabled : current.recallEnabled ?? defaults.recallEnabled,
    suggestEnabled: typeof patch.suggestEnabled === "boolean" ? patch.suggestEnabled : current.suggestEnabled ?? defaults.suggestEnabled,
  }), defaults)
  return readMemorySettings()
}
