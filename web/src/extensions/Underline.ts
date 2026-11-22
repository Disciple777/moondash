import { Mark } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    underline: {
      toggleUnderline: () => ReturnType
    }
  }
}

/**
 * Underlined text, written to the file as <u>…</u>.
 *
 * Markdown has no underline of its own, so this is one of the few tags the
 * editor genuinely emits — `u` is in MarkdownFidelity's HTML_TAGS, which is
 * what lets it survive the round-trip instead of being kept as literal text.
 *
 * The serializer is written by hand for the same reason TextColor's is: the
 * generic HTML-mark path in tiptap-markdown renders through the DOM, which
 * rewrites the markup on every save.
 */
export const Underline = Mark.create({
  name: 'underline',

  parseHTML() {
    return [
      { tag: 'u' },
      // Word, Google Docs and the like paste underlines as a style, not a tag.
      {
        style: 'text-decoration',
        consuming: false,
        getAttrs: (value) => (String(value).includes('underline') ? {} : false)
      }
    ]
  },

  renderHTML() {
    return ['u', 0]
  },

  addCommands() {
    return {
      toggleUnderline:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name)
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-u': () => this.editor.commands.toggleUnderline()
    }
  },

  addStorage() {
    return {
      markdown: {
        serialize: { open: () => '<u>', close: () => '</u>' }
      }
    }
  }
})
