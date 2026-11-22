import { useLayoutEffect, useRef, type KeyboardEvent, type MutableRefObject } from 'react'

/**
 * The line ending a file uses. Editors hand text back with plain `\n` (a
 * textarea always normalises to it, and so does the markdown pipeline), so
 * saves re-apply the file's own style — otherwise every Windows (CRLF) file
 * would have all its line endings rewritten on the first edit.
 */
export function lineEndingOf(text: string): '\r\n' | '\n' {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

export function withLineEnding(text: string, eol: '\r\n' | '\n'): string {
  return eol === '\n' ? text : text.replace(/\r?\n/g, eol)
}

/** `.txt` files are edited as plain text: saved byte-for-byte, never as markdown. */
export function isPlainTextPath(path: string | null | undefined): boolean {
  return /\.txt$/i.test(path ?? '')
}

/**
 * The text surface for raw-markdown view and `.txt` files.
 *
 * Grows with its content instead of scrolling inside a fixed box, so a long
 * note scrolls with the page like the rich editor does, and Tab indents
 * instead of jumping focus out of the note.
 */
export function PlainTextArea({
  value,
  onChange,
  className,
  tabText = '\t',
  placeholder,
  innerRef
}: {
  value: string
  onChange: (value: string) => void
  className: string
  /** What Tab inserts: a real tab for .txt, two spaces for markdown source. */
  tabText?: string
  placeholder?: string
  /** Handed the textarea so find-in-page can select its matches. */
  innerRef?: MutableRefObject<HTMLTextAreaElement | null>
}) {
  const own = useRef<HTMLTextAreaElement | null>(null)
  const ref = innerRef ?? own

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // Collapsing to 'auto' to measure would briefly shrink the page and clamp
    // its scroll position, making the view jump while typing near the end.
    const scroller = el.closest('.main') as HTMLElement | null
    const keep = scroller?.scrollTop
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
    if (scroller && keep !== undefined) scroller.scrollTop = keep
  }, [value])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
    e.preventDefault()
    // execCommand keeps the edit on the textarea's own undo stack and fires a
    // normal input event; fall back to setRangeText where it's unavailable.
    if (!document.execCommand?.('insertText', false, tabText)) {
      const el = e.currentTarget
      el.setRangeText(tabText, el.selectionStart, el.selectionEnd, 'end')
      onChange(el.value)
    }
  }

  return (
    <textarea
      ref={ref}
      className={className}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      spellCheck={false}
      autoFocus
    />
  )
}
