import { Mark } from '@tiptap/core'

/**
 * Inline text color. Renders as <span style="color:…"> and round-trips
 * through markdown because tiptap-markdown is configured with html: true —
 * the serializer emits the span's HTML and the parser maps it back through
 * this mark's parseHTML rule.
 */
export const TextColor = Mark.create({
  name: 'textColor',

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).style.color || null,
        renderHTML: (attrs) => (attrs.color ? { style: `color: ${attrs.color}` } : {})
      }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span',
        getAttrs: (el) => {
          const color = (el as HTMLElement).style.color
          return color ? { color } : false
        }
      }
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', HTMLAttributes, 0]
  }
})
