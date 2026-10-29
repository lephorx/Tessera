"use client"

import { useMemo } from "react"
import CodeMirror, { EditorView, keymap } from "@uiw/react-codemirror"
import { indentWithTab } from "@codemirror/commands"
import { StreamLanguage, type StreamParser } from "@codemirror/language"
import type { Extension } from "@codemirror/state"
import { json } from "@codemirror/lang-json"
import { yaml } from "@codemirror/lang-yaml"
import { javascript } from "@codemirror/lang-javascript"
import { xml } from "@codemirror/lang-xml"
import { html } from "@codemirror/lang-html"
import { css } from "@codemirror/lang-css"
import { markdown } from "@codemirror/lang-markdown"
import { properties } from "@codemirror/legacy-modes/mode/properties"
import { toml } from "@codemirror/legacy-modes/mode/toml"
import { shell } from "@codemirror/legacy-modes/mode/shell"
import { python } from "@codemirror/legacy-modes/mode/python"
import { lua } from "@codemirror/legacy-modes/mode/lua"
import { java, kotlin } from "@codemirror/legacy-modes/mode/clike"
import { githubDark } from "@uiw/codemirror-theme-github"

// Server logs: timestamps, [thread/LEVEL] tags and the level words (WARN
// orange, ERROR red)
const logParser: StreamParser<unknown> = {
  name: "log",
  token(stream) {
    if (stream.sol() && stream.match(/^\[?\d{1,2}:\d{2}:\d{2}(\.\d+)?\]?/))
      return "comment"
    if (stream.match(/^\[?\d{4}-\d{2}-\d{2}[ T][\d:.,]+\]?/)) return "comment"
    if (stream.match(/^(ERROR|FATAL|SEVERE|Exception|Caused by)\b/))
      return "invalid"
    if (stream.match(/^(WARN|WARNING)\b/)) return "bool"
    if (stream.match(/^(INFO|DEBUG|TRACE)\b/)) return "atom"
    if (stream.match(/^\[[^\]]*\/(ERROR|FATAL)\]/)) return "invalid"
    if (stream.match(/^\[[^\]]*\/WARN\]/)) return "bool"
    if (stream.match(/^\[[^\]]*\]/)) return "meta"
    if (stream.match(/^\s+at [\w$.<>]+\(.*\)/)) return "comment"
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return "string"
    if (stream.match(/^-?\d+(\.\d+)?\b/)) return "number"
    stream.next()
    return null
  },
}

const legacy = (parser: StreamParser<unknown>) => StreamLanguage.define(parser)

/** syntax highlighting for a file name, or null for plain text */
export function languageFor(name: string): Extension | null {
  const lower = name.toLowerCase()
  const ext = lower.includes(".") ? lower.split(".").pop()! : lower
  if (lower.endsWith(".log") || lower.endsWith(".log.txt"))
    return legacy(logParser)
  switch (ext) {
    case "json":
    case "json5":
    case "mcmeta":
    case "jsonc":
      return json()
    case "yml":
    case "yaml":
      return yaml()
    case "properties":
    case "cfg":
    case "conf":
    case "ini":
    case "env":
    case "lang":
      return legacy(properties)
    case "toml":
      return legacy(toml)
    case "js":
    case "mjs":
    case "cjs":
      return javascript()
    case "ts":
    case "mts":
      return javascript({ typescript: true })
    case "xml":
    case "pom":
      return xml()
    case "html":
    case "htm":
      return html()
    case "css":
      return css()
    case "md":
    case "markdown":
      return markdown()
    case "sh":
    case "bash":
    case "command":
    case "zsh":
      return legacy(shell)
    case "py":
      return legacy(python)
    case "lua":
      return legacy(lua)
    case "java":
      return legacy(java)
    case "kt":
    case "kts":
      return legacy(kotlin)
    default:
      return null
  }
}

/** files that read better wrapped than scrolled sideways */
const wrapsLines = (name: string) => /\.(log|txt|md|markdown)$/i.test(name)

// Fit the GitHub dark colours into the dialog: transparent background,
// the app's mono font, and a full-height scroller
const fit = EditorView.theme({
  "&": { height: "100%", backgroundColor: "transparent", fontSize: "12px" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono), ui-monospace, monospace",
    lineHeight: "1.6",
  },
  ".cm-gutters": { backgroundColor: "transparent", borderRight: "none" },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "rgb(255 255 255 / 0.04)",
  },
  "&.cm-focused": { outline: "none" },
})

interface Props {
  name: string
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  onSave?: () => void
  autoFocus?: boolean
}

export default function CodeEditor({
  name,
  value,
  onChange,
  readOnly = false,
  onSave,
  autoFocus,
}: Props) {
  const extensions = useMemo(() => {
    const list: Extension[] = [fit, keymap.of([indentWithTab])]
    const language = languageFor(name)
    if (language) list.push(language)
    if (wrapsLines(name)) list.push(EditorView.lineWrapping)
    if (onSave)
      list.push(
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              onSave()
              return true
            },
          },
        ])
      )
    return list
  }, [name, onSave])

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      editable={!readOnly}
      autoFocus={autoFocus}
      theme={githubDark}
      extensions={extensions}
      height="100%"
      className="h-full"
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: !readOnly,
        highlightActiveLineGutter: !readOnly,
        bracketMatching: true,
        closeBrackets: !readOnly,
        autocompletion: false,
        searchKeymap: true,
        tabSize: 2,
      }}
    />
  )
}
