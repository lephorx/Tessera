import { Geist, Geist_Mono, Montserrat } from "next/font/google"

import "./globals.css"
import { Toaster } from "@/components/ui/sonner"
import { VersionBadge } from "@/components/VersionBadge"
import { cn } from "@/lib/utils"
import { DESIGN_BOOT_SCRIPT } from "@/lib/designBoot"

const montserrat = Montserrat({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      // the boot script sets the design and light/dark before React runs
      suppressHydrationWarning
      data-design="modern"
      className={cn(
        "dark antialiased",
        fontMono.variable,
        "font-sans",
        montserrat.variable
      )}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: DESIGN_BOOT_SCRIPT }} />
      </head>
      <body>
        {children}
        <VersionBadge />
        <Toaster position="bottom-right" />
      </body>
    </html>
  )
}
