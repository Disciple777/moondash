import { Extension, type Editor } from '@tiptap/core'
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import { useEffect, useRef } from 'react'

export interface SlashRange {
  from: number
  to: number
}

export interface SlashItem {
  title: string
  description: string
  keywords: string[]
  icon: string
  command: (props: { editor: Editor; range: SlashRange }) => void
  /**
   * Hide the item when the editor doesn't load the extension it needs.
   * Omitted means "always available".
   */
  enabled?: (editor: Editor) => boolean
}

const ITEMS: SlashItem[] = [
  {
    title: 'Text',
    description: 'Plain paragraph',
    keywords: ['text', 'paragraph', 'p', 'plain'],
    icon: 'Aa',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setParagraph().run()
  },
  {
    title: 'Heading 1',
    description: 'Big section heading',
    keywords: ['h1', 'heading', 'title', 'big'],
    icon: 'H1',
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run()
  },
  {
    title: 'Heading 2',
    description: 'Medium section heading',
    keywords: ['h2', 'heading'],
    icon: 'H2',
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run()
  },
  {
    title: 'Heading 3',
    description: 'Small section heading',
    keywords: ['h3', 'heading'],
    icon: 'H3',
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run()
  },
  {
    title: 'Bullet List',
    description: 'Create a simple bullet list',
    keywords: ['ul', 'list', 'bullet', 'unordered'],
    icon: '•',
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run()
  },
  {
    title: 'Numbered List',
    description: 'Create a numbered list',
    keywords: ['ol', 'list', 'numbered', 'ordered'],
    icon: '1.',
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run()
  },
  {
    title: 'To-do List',
    description: 'Track tasks with checkboxes',
    keywords: ['todo', 'task', 'checklist', 'checkbox'],
    icon: '☑',
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run()
  },
  {
    title: 'Toggle list',
    description: 'Collapsible block — click the arrow to show or hide',
    keywords: ['toggle', 'collapse', 'details', 'hide', 'show', 'accordion', 'fold'],
    icon: '▸',
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setToggle().run()
  },
  {
    title: 'Quote',
    description: 'Capture a quote',
    keywords: ['quote', 'blockquote', 'citation'],
    icon: '❝',
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBlockquote().run()
  },
  {
    title: 'Code block',
    description: 'Add a fenced code block',
    keywords: ['code', 'pre', 'fence', 'snippet'],
    icon: '</>',
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
  },
  {
    title: 'Table',
    description: '3×3 table with a header row',
    keywords: ['table', 'grid', 'rows', 'columns', 'cells', 'spreadsheet'],
    icon: '▦',
    // The table nodes only exist when the Table extensions are loaded.
    enabled: (editor) => editor.schema.nodes.table !== undefined,
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run()
  },
  {
    title: 'Divider',
    description: 'Insert a horizontal rule',
    keywords: ['hr', 'divider', 'line', 'separator'],
    icon: '—',
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run()
  }
]

function filterItems(query: string, editor: Editor): SlashItem[] {
  const available = ITEMS.filter((item) => item.enabled?.(editor) ?? true)
  const q = query.trim().toLowerCase()
  if (q === '') return available
  return available.filter(
    (item) =>
      item.title.toLowerCase().includes(q) || item.keywords.some((k) => k.includes(q))
  )
}

function createPopup() {
  const el = document.createElement('div')
  el.className = 'slash-popup'
  document.body.appendChild(el)
  return {
    el,
    update(props: SuggestionProps<SlashItem>) {
      const rect = props.clientRect?.()
      if (rect) {
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - 320))
        const top = Math.min(rect.bottom + 6, window.innerHeight - 340)
        el.style.left = `${left}px`
        el.style.top = `${top}px`
      }
    },
    destroy() {
      el.remove()
    }
  }
}

interface SlashMenuListProps {
  items: SlashItem[]
  command: (item: SlashItem) => void
  query: string
  selectedIndex: number
  onSelectIndex: (index: number) => void
}

function SlashMenuList({ items, command, query, selectedIndex, onSelectIndex }: SlashMenuListProps) {
  const selectedRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (items.length === 0) {
    return <div className="slash-menu-empty">No commands match “{query}”</div>
  }

  return (
    <div className="slash-menu">
      <div className="slash-menu-label">Quick insert</div>
      {items.map((item, index) => (
        <button
          key={item.title}
          type="button"
          ref={index === selectedIndex ? selectedRef : undefined}
          className={`slash-item ${index === selectedIndex ? 'is-selected' : ''}`}
          onMouseEnter={() => onSelectIndex(index)}
          onMouseDown={(e) => {
            e.preventDefault()
            command(item)
          }}
        >
          <span className="slash-item-icon">{item.icon}</span>
          <span className="slash-item-text">
            <span className="slash-item-title">{item.title}</span>
            <span className="slash-item-desc">{item.description}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

export const SlashMenu = Extension.create({
  name: 'slashMenu',

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: '/',
        allowSpaces: true,
        // The popup calls props.command(item); route it to the item's own
        // command so both mouse clicks and Enter/Tab actually apply the block.
        command: ({ editor, range, props }) => {
          props.command({ editor, range })
        },
        items: ({ editor, query }) => filterItems(query, editor),
        render: () => {
          let component: ReactRenderer | null = null
          let popup: ReturnType<typeof createPopup> | null = null
          let selectedIndex = 0
          // SuggestionKeyDownProps only carries { view, event, range }, so keep
          // the latest items + command in the closure for keyboard handling.
          let items: SlashItem[] = []
          let runCommand: ((item: SlashItem) => void) | null = null

          const destroy = () => {
            popup?.destroy()
            component?.destroy()
            popup = null
            component = null
          }

          const setSelectedIndex = (index: number) => {
            selectedIndex = index
            component?.updateProps({ selectedIndex })
          }

          return {
            onStart: (props) => {
              selectedIndex = 0
              items = props.items
              runCommand = props.command
              popup = createPopup()
              component = new ReactRenderer(SlashMenuList, {
                props: {
                  ...props,
                  selectedIndex,
                  onSelectIndex: setSelectedIndex
                },
                editor: props.editor
              })
              popup.el.appendChild(component.element)
              popup.update(props)
            },
            onUpdate: (props) => {
              items = props.items
              runCommand = props.command
              const count = props.items.length
              if (count === 0) selectedIndex = 0
              else if (selectedIndex >= count) selectedIndex = count - 1
              component?.updateProps({ ...props, selectedIndex, onSelectIndex: setSelectedIndex })
              popup?.update(props)
            },
            onKeyDown: (props) => {
              const { event } = props
              if (event.key === 'Escape') {
                destroy()
                return true
              }
              // Swallow confirm keys while the menu shows its empty state.
              if (items.length === 0) {
                return event.key === 'Enter' || event.key === 'Tab'
              }
              if (event.key === 'ArrowDown') {
                setSelectedIndex((selectedIndex + 1) % items.length)
                return true
              }
              if (event.key === 'ArrowUp') {
                setSelectedIndex((selectedIndex - 1 + items.length) % items.length)
                return true
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                const item = items[selectedIndex]
                if (item && runCommand) runCommand(item)
                // Close even when the command was a no-op (e.g. toggling a
                // format that is already active) — onExit fires on doc
                // changes, this covers the rest.
                destroy()
                return true
              }
              return false
            },
            onExit: destroy
          }
        }
      })
    ]
  }
})
