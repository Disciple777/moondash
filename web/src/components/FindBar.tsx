import { useEffect, useRef, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'

/**
 * The in-document find bar (Ctrl+F), shared by the rich editor and the
 * plain-text / raw-markdown surfaces. It owns no search logic of its own —
 * each editor counts and highlights its own matches and passes the numbers in,
 * because a TipTap document and a textarea have nothing in common there.
 */
export function FindBar({
  query,
  onQuery,
  count,
  current,
  onNext,
  onPrev,
  onClose
}: {
  query: string
  onQuery: (query: string) => void
  count: number
  /** Zero-based index of the highlighted match, or -1 when there is none. */
  current: number
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Pressing Ctrl+F while the bar is already open re-focuses and selects, the
  // way a browser's own find does, so a second press starts a new search.
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) onPrev()
      else onNext()
    }
  }

  const empty = query !== '' && count === 0

  return (
    <div className="find-bar" role="search">
      <Search size={13} className="find-bar-icon" />
      <input
        ref={inputRef}
        className={`find-bar-input${empty ? ' is-empty' : ''}`}
        value={query}
        placeholder="Find in page…"
        aria-label="Find in page"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <span className="find-bar-count" aria-live="polite">
        {query === '' ? '' : count === 0 ? 'No results' : `${current + 1} of ${count}`}
      </span>
      <button
        type="button"
        className="icon-btn find-bar-btn"
        title="Previous match (Shift+Enter)"
        onClick={onPrev}
        disabled={count === 0}
      >
        <ChevronUp size={14} />
      </button>
      <button
        type="button"
        className="icon-btn find-bar-btn"
        title="Next match (Enter)"
        onClick={onNext}
        disabled={count === 0}
      >
        <ChevronDown size={14} />
      </button>
      <button type="button" className="icon-btn find-bar-btn" title="Close (Esc)" onClick={onClose}>
        <X size={14} />
      </button>
    </div>
  )
}

/** Every occurrence of `query` in `text`, as [start, end] offsets. */
export function textMatches(text: string, query: string): [number, number][] {
  if (query === '') return []
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  const out: [number, number][] = []
  let at = haystack.indexOf(needle)
  while (at !== -1) {
    out.push([at, at + needle.length])
    at = haystack.indexOf(needle, at + needle.length)
  }
  return out
}
