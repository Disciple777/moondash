/**
 * Real-browser harness for the workspace dialog issues: mounts the ACTUAL
 * WorkspaceDialog component (real styles.css) under a dark theme and exposes
 * measurements for the puppeteer driver (scripts/drive-modal.mjs):
 *   - does the modal overflow the viewport (create button unreachable)?
 *   - what color do the icon-grid lucide icons actually render?
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { WorkspaceDialog } from '../src/components/WorkspaceDialog'
import '../src/styles.css'

document.documentElement.setAttribute('data-theme', 'default-dark')

function Harness() {
  const [open, setOpen] = React.useState(true)
  return (
    <div>
      <WorkspaceDialog
        open={open}
        mode="create"
        onSave={async () => {
          console.log('[harness] saved')
          setOpen(false)
        }}
        onClose={() => {
          console.log('[harness] closed')
          setOpen(false)
        }}
      />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
