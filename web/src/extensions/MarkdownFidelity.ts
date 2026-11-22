import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { emptyTaskListPlugin } from './EmptyTaskList'

/**
 * Makes a note come back from disk exactly as it was written.
 *
 * tiptap-markdown round-trips a note through markdown-it (parse) and
 * prosemirror-markdown (serialize). Out of the box that pipeline normalises
 * away real content, and because the editor autosaves, every loss was written
 * straight back to the `.md` file:
 *
 *   line one⏎line two           → "line one line two"   (line breaks flattened)
 *   a⏎⏎⏎⏎b                      → "a⏎⏎b"                (blank lines collapsed)
 *   use <something here> as x   → "use as x"            (angle brackets deleted)
 *   C:\Users\CPU                → "C:\\Users\\CPU"      (backslashes doubled)
 *
 * This extension fixes each one at both ends of the pipeline, so what is read
 * is what gets written:
 *
 * - LINE BREAKS: the editor parses with `breaks: true` (set on the Markdown
 *   extension), so a newline inside a paragraph is a real line break; hard
 *   breaks are written back as a plain newline instead of `\⏎`.
 * - BLANK LINES: extra blank lines between blocks become empty paragraphs, and
 *   empty paragraphs are written back as blank lines. Only at the top level,
 *   outside code fences and toggles.
 * - ANGLE BRACKETS: markdown's HTML support is kept for the few tags the editor
 *   itself uses (text colour spans, toggles, tables…). Anything else that merely
 *   looks like a tag — `<something here>`, `<T>`, `<!-- note -->` — is kept as
 *   literal text instead of being parsed as HTML and dropped.
 * - BACKSLASHES: a `\` is only escaped where markdown would otherwise read it as
 *   an escape, so Windows paths keep single backslashes.
 *
 * Hooks into tiptap-markdown via the per-extension `parse.setup(md)` spec — the
 * only hook that also runs for the INITIAL content, which tiptap-markdown parses
 * inside its own onBeforeCreate before other extensions can patch anything.
 * Serializers are patched onto the paragraph / hardBreak / text specs, which
 * tiptap-markdown re-reads on every serialize.
 */

// ── HTML the editor genuinely uses ────────────────────────────────────────────

/**
 * Tags parsed as real HTML. Everything else that looks like markup is literal
 * text. Covers what the editor writes itself (span for text colour,
 * details/summary for toggles, the HTML fallback tiptap-markdown uses for tables
 * and line breaks inside cells) plus common inline tags people put in markdown.
 */
const HTML_TAGS = [
  'a', 'b', 'blockquote', 'br', 'code', 'col', 'colgroup', 'del', 'details', 'div',
  'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'input', 'kbd', 'label',
  'li', 'mark', 'ol', 'p', 'pre', 's', 'span', 'strong', 'sub', 'summary', 'sup',
  'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul'
]
const HTML_TAG_SET = new Set(HTML_TAGS)

function isKnownHtml(fragment: string): boolean {
  const match = /^<\/?([A-Za-z][A-Za-z0-9-]*)/.exec(fragment.trimStart())
  return match !== null && HTML_TAG_SET.has(match[1].toLowerCase())
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * A `<` in plain text must be escaped only if the parser would otherwise read
 * it as markup: one of the known tags above, or an autolink (`<https://…>`,
 * `<me@example.com>`). Anything else is parsed back as text, so it's written
 * as-is and `<something here>` survives verbatim.
 */
const LT_NEEDS_ESCAPE = new RegExp(
  '^(?:' +
    `\\/?(?:${HTML_TAGS.join('|')})(?=[\\s/>])` + // known tag
    '|[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\\s<>]*>' + // URI autolink
    "|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*>" + // email autolink
    ')',
  'i'
)

/** `&amp;` / `&#39;`-shaped sequences would be decoded as entities on the way back in. */
const ENTITY_LIKE = /^&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/

function escapeMarkupInText(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '<' && LT_NEEDS_ESCAPE.test(text.slice(i + 1))) out += '&lt;'
    else if (ch === '&' && ENTITY_LIKE.test(text.slice(i))) out += '&amp;'
    else out += ch
  }
  return out
}

// ── Backslashes ───────────────────────────────────────────────────────────────

/** Placeholder that survives prosemirror-markdown's escaper untouched. */
const MARKER = '\u0000\u0000'

/** ASCII punctuation — the only characters `\` can legitimately escape. */
const ASCII_PUNCT = /[!-/:-@[-`{-~]/

/**
 * prosemirror-markdown escapes EVERY backslash. CommonMark only treats `\` as
 * an escape before ASCII punctuation, so re-emit each one bare unless it
 * precedes punctuation, another backslash, or a line end (a hard break).
 */
function restoreBackslashes(chunk: string): string {
  let out = ''
  let i = 0
  while (i < chunk.length) {
    if (!chunk.startsWith(MARKER, i)) {
      out += chunk[i]
      i += 1
      continue
    }
    const rest = i + MARKER.length
    const next = chunk[rest]
    const needsEscape =
      chunk.startsWith(MARKER, rest) || next === undefined || next === '\n' || ASCII_PUNCT.test(next)
    out += needsEscape ? '\\\\' : '\\'
    i = rest
  }
  return out
}

// ── Blank lines ───────────────────────────────────────────────────────────────

/** Source line for one empty paragraph; always followed by a blank line. */
const EMPTY_PARAGRAPH = '<p></p>'

const isBlank = (line: string) => /^[ \t]*$/.test(line)

/**
 * Turn runs of extra blank lines into explicit empty paragraphs. The counts are
 * the exact inverse of how empty paragraphs are serialized below:
 *   k empty paragraphs at the start        ⇄ k leading blank lines
 *   k between two blocks                   ⇄ k + 1 blank lines
 *   k at the end                           ⇄ k + 1 trailing newlines
 * Leaves fenced code, toggles and indented continuations alone.
 */
export function expandBlankLines(src: string): string {
  const lines = src.split('\n')
  const n = lines.length

  if (lines.every(isBlank)) {
    // An empty file is one empty paragraph already; each newline adds one.
    return n <= 1 ? src : Array(n).fill(EMPTY_PARAGRAPH).join('\n\n')
  }

  let first = 0
  while (isBlank(lines[first])) first++
  let last = n - 1
  while (isBlank(lines[last])) last--

  const out: string[] = []
  for (let k = 0; k < first; k++) out.push(EMPTY_PARAGRAPH, '')

  let fence: { ch: string; len: number } | null = null
  let detailsDepth = 0
  let i = first
  while (i <= last) {
    const line = lines[i]
    if (fence || !isBlank(line)) {
      out.push(line)
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)
      if (fence) {
        if (marker && marker[1][0] === fence.ch && marker[1].length >= fence.len && /^ {0,3}[`~]+\s*$/.test(line)) {
          fence = null
        }
      } else if (marker) {
        fence = { ch: marker[1][0], len: marker[1].length }
      } else {
        detailsDepth += (line.match(/<details\b/gi) ?? []).length
        detailsDepth -= (line.match(/<\/details\s*>/gi) ?? []).length
        if (detailsDepth < 0) detailsDepth = 0
      }
      i++
      continue
    }

    let j = i
    while (j <= last && isBlank(lines[j])) j++
    const run = j - i
    // Only when the next block starts at column 0: an indented line is a
    // continuation (list item, indented code) that a marker would break.
    if (run >= 2 && detailsDepth === 0 && /^\S/.test(lines[j])) {
      out.push('')
      for (let k = 1; k < run; k++) out.push(EMPTY_PARAGRAPH, '')
    } else {
      for (let k = i; k < j; k++) out.push(lines[k])
    }
    i = j
  }

  const trailing = n - 1 - last
  for (let k = 1; k < trailing; k++) out.push('', EMPTY_PARAGRAPH)
  if (trailing > 0) out.push('')
  return out.join('\n')
}

// ── markdown-it wiring ────────────────────────────────────────────────────────

// Structural types only — markdown-it ships no TypeScript declarations.
interface MdToken {
  content: string
}
interface MarkdownIt {
  core: { ruler: { after: (name: string, rule: string, fn: (state: { src: string }) => void) => void } }
  renderer: { rules: Record<string, (tokens: MdToken[], idx: number) => string> }
  use: (plugin: unknown) => void
}

const patchedParsers = new WeakSet<object>()

function setupParser(md: MarkdownIt): void {
  if (patchedParsers.has(md)) return
  patchedParsers.add(md)

  md.core.ruler.after('normalize', 'moondash_blank_lines', (state) => {
    state.src = expandBlankLines(state.src)
  })

  md.renderer.rules.html_inline = (tokens, idx) => {
    const html = tokens[idx].content
    return isKnownHtml(html) ? html : escapeHtml(html)
  }
  md.renderer.rules.html_block = (tokens, idx) => {
    const html = tokens[idx].content
    if (isKnownHtml(html)) return html
    // Not markup the editor understands: keep it as a paragraph of text,
    // one line per line.
    const body = html.replace(/\n+$/, '').split('\n').map(escapeHtml).join('<br>')
    return `<p>${body}</p>`
  }

  md.use(emptyTaskListPlugin)
}

// ── Serializers ───────────────────────────────────────────────────────────────

interface SerializerState {
  out: string
  inTable?: boolean
  atBlockStart?: boolean
  text: (text: string, escape?: boolean) => void
  write: (content?: string) => void
  renderInline: (node: PmNode) => void
  closeBlock: (node: PmNode) => void
}
interface PmNode {
  text?: string
  childCount: number
  type: { name: string }
}
type Serialize = (state: SerializerState, node: PmNode, parent?: PmNode) => void

function specFor(editor: Editor, name: string): { serialize?: Serialize } | null {
  const ext = editor.extensionManager.extensions.find((e) => e.name === name)
  if (!ext) return null
  // Core nodes (text, paragraph, hardBreak) declare no storage of their own.
  if (!ext.storage) ext.storage = {}
  const storage = ext.storage as { markdown?: { serialize?: Serialize } }
  return storage.markdown ?? (storage.markdown = {})
}

const serializeText: Serialize = (state, node) => {
  // Right after a hard break the text starts a new source line, where `- `,
  // `# `, `> ` or `1. ` would be read back as a list/heading/quote.
  // prosemirror-markdown only escapes those at the start of a BLOCK (and resets
  // its flag right after rendering the break), so re-arm it here.
  if (state.out.endsWith('\n')) state.atBlockStart = true
  const start = state.out.length
  state.text(escapeMarkupInText(node.text ?? '').replace(/\\/g, MARKER))
  // state.text() may prepend list markers or quote prefixes; restoring over
  // the whole appended chunk is harmless because only markers are rewritten.
  state.out = state.out.slice(0, start) + restoreBackslashes(state.out.slice(start))
}

const serializeParagraph: Serialize = (state, node, parent) => {
  if (node.childCount === 0 && parent?.type.name === 'doc') {
    // write('') flushes the previous block's separator, so this empty
    // paragraph costs exactly one extra blank line instead of vanishing.
    state.write('')
    state.closeBlock(node)
    return
  }
  state.renderInline(node)
  state.closeBlock(node)
}

const serializeHardBreak: Serialize = (state) => {
  // Table cells can't hold a raw newline — keep tiptap-markdown's HTML form.
  state.write(state.inTable ? '<br>' : '\n')
}

function patchSerializers(editor: Editor): void {
  const text = specFor(editor, 'text')
  if (text) text.serialize = serializeText
  const paragraph = specFor(editor, 'paragraph')
  if (paragraph) paragraph.serialize = serializeParagraph
  const hardBreak = specFor(editor, 'hardBreak')
  if (hardBreak) hardBreak.serialize = serializeHardBreak
}

export const MarkdownFidelity = Extension.create({
  name: 'markdownFidelity',

  // tiptap-markdown tracks "tight" (no blank line between items) for bullet and
  // ordered lists only, so every task list was rewritten as a loose list with a
  // blank line between each item. Give task lists the same attribute.
  addGlobalAttributes() {
    return [
      {
        types: ['taskList'],
        attributes: {
          tight: {
            default: true,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute('data-tight') === 'true' || !element.querySelector('p'),
            renderHTML: (attributes: { tight?: boolean }) => ({
              'data-tight': attributes.tight ? 'true' : null
            })
          }
        }
      }
    ]
  },

  addStorage() {
    return {
      markdown: {
        parse: {
          setup(md: MarkdownIt) {
            setupParser(md)
          }
        }
      }
    }
  },

  onBeforeCreate() {
    patchSerializers(this.editor)
  }
})
