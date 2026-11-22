import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface FindMatch {
  from: number
  to: number
}

interface FindState {
  query: string
  /** Index into `matches` of the highlighted hit, or -1 when there is none. */
  index: number
  matches: FindMatch[]
}

export const findKey = new PluginKey<FindState>('findHighlight')

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    findHighlight: {
      /** Set the search term; '' clears the highlights. */
      setFindQuery: (query: string) => ReturnType
      /** Highlight match `index` (clamped) and scroll it into view. */
      setFindIndex: (index: number) => ReturnType
    }
  }
}

/**
 * Collect every occurrence of `query` in the document.
 *
 * Searching per text node rather than over one flattened string: a match that
 * straddles two nodes (half of it bold, say) is rare enough in prose to skip,
 * and doing it this way keeps the node offset → document position mapping
 * exact, which is what the decorations need.
 */
function findMatches(doc: import('@tiptap/pm/model').Node, query: string): FindMatch[] {
  const needle = query.toLowerCase()
  if (needle === '') return []
  const matches: FindMatch[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const haystack = node.text.toLowerCase()
    let at = haystack.indexOf(needle)
    while (at !== -1) {
      matches.push({ from: pos + at, to: pos + at + needle.length })
      at = haystack.indexOf(needle, at + needle.length)
    }
  })
  return matches
}

/** Read the current find state off an editor, for the UI (counts, position). */
export function findState(state: import('@tiptap/pm/state').EditorState): FindState {
  return findKey.getState(state) ?? { query: '', index: -1, matches: [] }
}

/**
 * In-document find: highlights every match and marks the current one.
 *
 * The matches live in plugin state rather than in the document, so nothing a
 * search does can be saved to the file or land in the undo history.
 */
export const FindHighlight = Extension.create({
  name: 'findHighlight',

  addCommands() {
    return {
      setFindQuery:
        (query: string) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(findKey, { query }))
          return true
        },
      setFindIndex:
        (index: number) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(findKey, { index }))
          return true
        }
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => ({ query: '', index: -1, matches: [] }),
          apply(tr, prev) {
            const meta = tr.getMeta(findKey) as { query?: string; index?: number } | undefined

            if (meta?.query !== undefined) {
              const matches = findMatches(tr.doc, meta.query)
              return { query: meta.query, matches, index: matches.length > 0 ? 0 : -1 }
            }

            if (meta?.index !== undefined) {
              if (prev.matches.length === 0) return { ...prev, index: -1 }
              // Wrap around, so Enter at the last match goes back to the first.
              const n = prev.matches.length
              const index = ((meta.index % n) + n) % n
              return { ...prev, index }
            }

            if (!tr.docChanged) return prev
            // The document changed under us: re-find rather than try to map the
            // old ranges, which would drift as text is typed around them.
            const matches = findMatches(tr.doc, prev.query)
            return {
              ...prev,
              matches,
              index: matches.length === 0 ? -1 : Math.min(Math.max(prev.index, 0), matches.length - 1)
            }
          }
        },
        props: {
          decorations(state) {
            const find = findKey.getState(state)
            if (!find || find.matches.length === 0) return null
            return DecorationSet.create(
              state.doc,
              find.matches.map((m, i) =>
                Decoration.inline(m.from, m.to, {
                  class: i === find.index ? 'find-hit is-current' : 'find-hit'
                })
              )
            )
          }
        }
      })
    ]
  }
})
