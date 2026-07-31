import { z } from "zod"

export const personaSchema = z.enum(["consumer", "builder", "admin"])
export type Persona = z.infer<typeof personaSchema>

const personaRank: Record<Persona, number> = {
  consumer: 0,
  builder: 1,
  admin: 2,
}

export function personaCanAccess(actual: Persona, required: Persona): boolean {
  return personaRank[actual] >= personaRank[required]
}
