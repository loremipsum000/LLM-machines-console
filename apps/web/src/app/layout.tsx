import type { Metadata } from "next"
import type { ReactNode } from "react"
import { productCopy } from "@llm-machines/copy"
import { urbanist } from "./fonts"
import { Providers } from "./providers"
import "./globals.css"

export const metadata: Metadata = {
  title: productCopy.appName,
  description: productCopy.metadata.description,
  icons: {
    icon: [
      { url: "/favicon.ico", type: "image/x-icon" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html className={urbanist.variable} lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
