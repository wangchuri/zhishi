import { cn } from "@/lib/utils"

const logoSrc = `${import.meta.env.BASE_URL}logo.jpg`

const sizeMap = {
  sm: "w-8 h-8",
  md: "w-9 h-9",
  lg: "w-14 h-14",
} as const

interface AppLogoProps {
  size?: keyof typeof sizeMap
  className?: string
}

export function AppLogo({ size = "md", className }: AppLogoProps) {
  return (
    <img
      src={logoSrc}
      alt="知拾"
      className={cn(sizeMap[size], "object-cover rounded-[8px] shrink-0", className)}
    />
  )
}
