import localFont from "next/font/local"

export const urbanist = localFont({
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
  preload: true,
  src: [
    {
      path: "../../public/fonts/urbanist/Urbanist-Thin.ttf",
      style: "normal",
      weight: "100",
    },
    {
      path: "../../public/fonts/urbanist/Urbanist-ThinItalic.ttf",
      style: "italic",
      weight: "100",
    },
    {
      path: "../../public/fonts/urbanist/Urbanist-ExtraLight.ttf",
      style: "normal",
      weight: "200",
    },
    {
      path: "../../public/fonts/urbanist/Urbanist-ExtraLightItalic.ttf",
      style: "italic",
      weight: "200",
    },
    {
      path: "../../public/fonts/urbanist/Urbanist-Light.ttf",
      style: "normal",
      weight: "300",
    },
    {
      path: "../../public/fonts/urbanist/Urbanist-LightItalic.ttf",
      style: "italic",
      weight: "300",
    },
    {
      path: "../../public/fonts/urbanist/Urbanist-Regular.ttf",
      style: "normal",
      weight: "400",
    },
    {
      path: "../../public/fonts/urbanist/Urbanist-Italic.ttf",
      style: "italic",
      weight: "400",
    },
    {
      path: "../../public/fonts/urbanist/Urbanist-Medium.ttf",
      style: "normal",
      weight: "500",
    },
    {
      path: "../../public/fonts/urbanist/Urbanist-MediumItalic.ttf",
      style: "italic",
      weight: "500",
    },
    {
      path: "../../public/fonts/urbanist/Urbanist-SemiBold.ttf",
      style: "normal",
      weight: "600",
    },
    {
      path: "../../public/fonts/urbanist/Urbanist-SemiBoldItalic.ttf",
      style: "italic",
      weight: "600",
    },
    {
      path: "../../public/fonts/urbanist/Urbanist-Bold.ttf",
      style: "normal",
      weight: "700",
    },
    {
      path: "../../public/fonts/urbanist/Urbanist-BoldItalic.ttf",
      style: "italic",
      weight: "700",
    },
    {
      path: "../../public/fonts/urbanist/Urbanist-ExtraBold.ttf",
      style: "normal",
      weight: "800",
    },
    {
      path: "../../public/fonts/urbanist/Urbanist-ExtraBoldItalic.ttf",
      style: "italic",
      weight: "800",
    },
    {
      path: "../../public/fonts/urbanist/Urbanist-Black.ttf",
      style: "normal",
      weight: "900",
    },
    {
      path: "../../public/fonts/urbanist/Urbanist-BlackItalic.ttf",
      style: "italic",
      weight: "900",
    },
  ],
  variable: "--font-urbanist",
})
