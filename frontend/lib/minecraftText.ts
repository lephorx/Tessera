// Minecraft's § formatting codes, for previewing a server description the
// way the multiplayer screen shows it.

export const SECTION = "§"

export const MC_COLORS: Record<string, { name: string; hex: string }> = {
  "0": { name: "Black", hex: "#000000" },
  "1": { name: "Dark Blue", hex: "#0000AA" },
  "2": { name: "Dark Green", hex: "#00AA00" },
  "3": { name: "Dark Aqua", hex: "#00AAAA" },
  "4": { name: "Dark Red", hex: "#AA0000" },
  "5": { name: "Dark Purple", hex: "#AA00AA" },
  "6": { name: "Gold", hex: "#FFAA00" },
  "7": { name: "Gray", hex: "#AAAAAA" },
  "8": { name: "Dark Gray", hex: "#555555" },
  "9": { name: "Blue", hex: "#5555FF" },
  a: { name: "Green", hex: "#55FF55" },
  b: { name: "Aqua", hex: "#55FFFF" },
  c: { name: "Red", hex: "#FF5555" },
  d: { name: "Light Purple", hex: "#FF55FF" },
  e: { name: "Yellow", hex: "#FFFF55" },
  f: { name: "White", hex: "#FFFFFF" },
}

export const MC_STYLES: Record<string, string> = {
  l: "Bold",
  o: "Italic",
  n: "Underline",
  m: "Strikethrough",
  k: "Obfuscated",
  r: "Reset",
}

export interface McSegment {
  text: string
  color: string
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  obfuscated: boolean
}

/** split a description into lines of equally formatted runs; `color` is
 *  where each line starts (the server list draws the motd in gray) */
export function parseMinecraftText(
  text: string,
  color = MC_COLORS["7"].hex
): McSegment[][] {
  const plain = {
    color,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    obfuscated: false,
  }
  let style = { ...plain }

  return text.split("\n").map((line) => {
    const segments: McSegment[] = []
    let buffer = ""
    const flush = () => {
      if (buffer) segments.push({ text: buffer, ...style })
      buffer = ""
    }
    for (let i = 0; i < line.length; i++) {
      const code = line[i] === SECTION ? line[i + 1]?.toLowerCase() : undefined
      if (code && (code in MC_COLORS || code in MC_STYLES)) {
        flush()
        // a color code also clears bold, italic etc.
        if (code in MC_COLORS) style = { ...plain, color: MC_COLORS[code].hex }
        else if (code === "r") style = { ...plain }
        else if (code === "l") style = { ...style, bold: true }
        else if (code === "o") style = { ...style, italic: true }
        else if (code === "n") style = { ...style, underline: true }
        else if (code === "m") style = { ...style, strike: true }
        else if (code === "k") style = { ...style, obfuscated: true }
        i++
        continue
      }
      buffer += line[i]
    }
    flush()
    return segments
  })
}
