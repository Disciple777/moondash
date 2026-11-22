import { Mark } from '@tiptap/core'

/**
 * Inline text color. Renders as <span style="color:…"> and round-trips
 * through markdown because tiptap-markdown is configured with html: true —
 * the serializer emits the span's HTML and the parser maps it back through
 * this mark's parseHTML rule.
 */
/**
 * The colour exactly as written in the style attribute. `el.style.color` would
 * hand back the browser's normalised form (`#e5484d` → `rgb(229, 72, 77)`), which
 * rewrote the file on the next save and stopped the toolbar recognising the
 * active swatch.
 */
function colorOf(el: HTMLElement): string | null {
  const match = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(el.getAttribute('style') ?? '')
  return match ? match[1].trim() : el.style.color || null
}

export const TextColor = Mark.create({
  name: 'textColor',

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => colorOf(el as HTMLElement),
        renderHTML: (attrs) => (attrs.color ? { style: `color: ${attrs.color}` } : {})
      }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span',
        getAttrs: (el) => {
          const color = colorOf(el as HTMLElement)
          return color ? { color } : false
        }
      }
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', HTMLAttributes, 0]
  },

  // Written by hand rather than through tiptap-markdown's generic HTML-mark
  // serializer, which renders via the DOM and gets the colour back in the
  // browser's normalised rgb() form — rewriting every coloured word in the file.
  addStorage() {
    return {
      markdown: {
        serialize: {
          open: (_state: unknown, mark: { attrs: { color?: string | null } }) =>
            mark.attrs.color ? `<span style="color: ${mark.attrs.color.replace(/"/g, '&quot;')}">` : '',
          close: (_state: unknown, mark: { attrs: { color?: string | null } }) =>
            mark.attrs.color ? '</span>' : ''
        }
      }
    }
  }
})
