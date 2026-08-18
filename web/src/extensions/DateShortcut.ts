import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { formatDate, loadDatePrefs } from '../state/PrefsContext'

const KEY = new PluginKey('dateShortcut')

/**
 * Replaces a user-configurable shortcut (default "@date") with the current
 * date in the configured format as soon as the shortcut is completed by
 * typing its final character. The shortcut must start a line or follow
 * whitespace so it never fires inside regular words.
 */
export const DateShortcut = Extension.create({
  name: 'dateShortcut',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: KEY,
        props: {
          handleTextInput: (view, from, to, text) => {
            if (!text) return false
            const prefs = loadDatePrefs()
            if (!prefs.enabled || !prefs.shortcut) return false
            const shortcut = prefs.shortcut

            const state = view.state
            const $from = state.doc.resolve(from)
            const parent = $from.parent
            if (!parent.isTextblock) return false
            // Never trigger inside code — users write literal text there.
            if (parent.type.name === 'codeBlock') return false
            if ($from.marks().some((m) => m.type.name === 'code')) return false
            if ($from.parentOffset < shortcut.length - 1) return false

            const before = parent.textBetween(0, $from.parentOffset, '\n', '\ufffc')
            // The keystroke under construction completes the shortcut.
            const candidate = before + text
            if (!candidate.endsWith(shortcut)) return false

            // The char before the shortcut must be a line start or whitespace.
            const boundaryIdx = before.length - shortcut.length
            if (boundaryIdx >= 0 && !/\s/.test(before[boundaryIdx])) return false

            // The shortcut is the last `shortcut.length` chars of candidate;
            // the part that lives in the doc is the rest of `before`. This also
            // stays correct when text carries several chars (IME composition).
            const docPortion = before.length - (candidate.length - shortcut.length)
            const absStart = from - docPortion
            if (absStart < 0) return false

            const dateStr = formatDate(new Date(), prefs.format)
            const tr = state.tr.insertText(dateStr, absStart, to)
            view.dispatch(tr)
            return true
          }
        }
      })
    ]
  }
})
