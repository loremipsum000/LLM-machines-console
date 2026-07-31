export const productCopy = {
  appName: "LLM Machines Console",
  metadata: {
    description: "Sovereign on-prem AI console",
  },
  pages: {
    signIn: {
      description:
        "Use your appliance identity to access applications, inference, hardware, team, and settings.",
      eyebrow: "Secure console access",
      footnote:
        "Console permissions are resolved from the appliance Keycloak realm after sign-in.",
      keycloak: "Sign in with Keycloak",
      title: "Sign in",
    },
  },
} as const
