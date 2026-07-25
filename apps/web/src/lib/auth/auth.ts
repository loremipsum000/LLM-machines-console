import NextAuth from "next-auth"
import Keycloak from "next-auth/providers/keycloak"
import { cleanOptionalEnvValue, ensureAuthUrlEnv } from "./env"
import { stringArrayValue } from "./role-claims"
import {
  attachKeycloakAccount,
  ensureFreshKeycloakAccessToken,
  freshKeycloakAccessToken,
} from "./token-refresh"

ensureAuthUrlEnv()

export const { auth, handlers, signIn, signOut } = NextAuth({
  pages: {
    signIn: "/auth/signin",
  },
  basePath: "/api/auth",
  providers: [
    Keycloak({
      clientId: cleanOptionalEnvValue(process.env.AUTH_KEYCLOAK_ID),
      clientSecret: cleanOptionalEnvValue(process.env.AUTH_KEYCLOAK_SECRET),
      issuer: cleanOptionalEnvValue(process.env.AUTH_KEYCLOAK_ISSUER),
    }),
  ],
  session: {
    strategy: "jwt",
  },
  trustHost: true,
  callbacks: {
    async jwt({ account, profile, token }) {
      if (account) {
        return attachKeycloakAccount(token, account, profile)
      }

      return ensureFreshKeycloakAccessToken(token)
    },
    session({ session, token }) {
      session.accessToken = freshKeycloakAccessToken(token)
      session.user.id = stringValue(token.sub) ?? session.user.email ?? ""
      session.user.email = stringValue(token.email) ?? session.user.email
      session.user.groups = stringArrayValue(token.groups)
      session.user.roles = stringArrayValue(token.roles)
      return session
    },
  },
})

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}
