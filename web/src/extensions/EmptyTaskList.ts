/**
 * markdown-it plugin: makes EMPTY task-list lines parse as real task items.
 *
 * The bundled `markdown-it-task-lists` plugin only recognizes a checkbox when
 * there is content AFTER the marker (`- [ ] thing`). A bare `- [ ]` (an empty
 * task item — exactly what pressing Enter in a task list produces) therefore
 * came back as a plain bullet with the literal text "[ ]" — an indented line
 * with no checkbox that couldn't be removed normally.
 *
 * This rule runs AFTER `github-task-lists` and catches inline tokens whose
 * content is ONLY the checkbox marker (`[ ]`, `[x]`, `[X]`, with optional
 * trailing whitespace), converting them the same way: checkbox input + the
 * `task-list-item` / `contains-task-list` classes that tiptap-markdown's
 * updateDOM relies on. It is idempotent — converted tokens no longer match.
 *
 * Registered once on the shared markdown-it instance
 * (`editor.storage.markdown.parser.md`) in Editor.tsx.
 */

// Structural types only — markdown-it ships no TypeScript declarations.
interface MdToken {
  type: string
  level: number
  content: string
  children: MdToken[] | null
  attrSet(name: string, value: string): void
}

interface MdState {
  tokens: MdToken[]
  Token: new (type: string, tag: string, nesting: number) => MdToken
}

interface MdLike {
  core: {
    ruler: {
      after(anchor: string, name: string, fn: (state: MdState) => void): void
    }
  }
}

const EMPTY_TASK_RE = /^\[([ xX])\]\s*$/

export const emptyTaskListPlugin = (md: MdLike) => {
  md.core.ruler.after('github-task-lists', 'moondash-empty-task-lists', (state) => {
    const tokens = state.tokens
    for (let i = 2; i < tokens.length; i++) {
      if (
        tokens[i].type === 'inline' &&
        tokens[i - 1]?.type === 'paragraph_open' &&
        tokens[i - 2]?.type === 'list_item_open' &&
        EMPTY_TASK_RE.test(tokens[i].content)
      ) {
        todoifyEmpty(tokens[i], state.Token)
        tokens[i - 2].attrSet('class', 'task-list-item')
        const parent = parentToken(tokens, i - 2)
        if (parent >= 0) tokens[parent].attrSet('class', 'contains-task-list')
      }
    }
  })
}

function parentToken(tokens: MdToken[], index: number): number {
  const targetLevel = tokens[index].level - 1
  for (let i = index - 1; i >= 0; i--) {
    if (tokens[i].level === targetLevel) return i
  }
  return -1
}

function todoifyEmpty(token: MdToken, TokenConstructor: MdState['Token']) {
  const m = token.content.match(/^\[([ xX])\]/)
  const checked = !!m && m[1].toLowerCase() === 'x'
  const checkbox = new TokenConstructor('html_inline', '', 0)
  checkbox.content =
    '<input class="task-list-item-checkbox" disabled="" type="checkbox"' +
    (checked ? ' checked=""' : '') +
    '>'
  // No text remains — the checkbox is the whole item content.
  token.children = [checkbox]
  token.content = ''
}
