import type { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    accessToken?: string
    user: DefaultSession["user"] & {
      id: string
      roles: string[]
      groups: string[]
    }
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string
    accessTokenExpiresAt?: number
    email?: string
    groups?: string[]
    preferredUsername?: string
    refreshToken?: string
    roles?: string[]
  }
}
