/** Extensions a note can have; anything else gets `.md` appended. */
const NOTE_EXT = /\.(md|markdown|txt)$/i

/** Names Windows refuses as files, whatever the extension. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

/** Control characters plus the ones Windows forbids in file names. */
const FORBIDDEN = /[\x00-\x1f<>:"/\\|?*]/g

/** The formats a new page can be created in. */
export type NoteExt = '.md' | '.txt'

/**
 * Turn what the user typed into a safe file name for a new page.
 * Notes are real files on disk (synced folders), so the name must be valid on
 * Windows: no `<>:"/\|?*` or control characters, no trailing dots or spaces,
 * no reserved device names. Appends `ext` (`.md` unless asked otherwise)
 * unless the name already ends in `.md`, `.markdown` or `.txt` — typing the
 * extension yourself still wins over the picker.
 * Returns '' when nothing usable is left.
 */
export function toFileName(input: string, ext: NoteExt = '.md'): string {
  let name = input.replace(FORBIDDEN, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '')
  if (name === '') return ''
  if (!NOTE_EXT.test(name)) name += ext
  const dot = name.lastIndexOf('.')
  if (RESERVED.test(name.slice(0, dot))) name = `${name.slice(0, dot)}_${name.slice(dot)}`
  return name
}

/** `name`, or `name-1`, `name-2`… — the first that isn't in `taken`. */
export function uniqueFileName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let n = 1
  while (taken.has(`${stem}-${n}${ext}`)) n++
  return `${stem}-${n}${ext}`
}

/**
 * What the app shows for a document: its alias ("second name") when one is
 * set, otherwise its own title. The file on disk is never renamed by an alias,
 * so the real name stays available for tooltips and the editor heading.
 */
export function docDisplayName(doc: { title: string; alias?: string | null }): string {
  const alias = doc.alias?.trim()
  return alias ? alias : doc.title
}
