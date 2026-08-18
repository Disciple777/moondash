// Live end-to-end check of the folders API against the production server.
// Creates a throwaway account, exercises every folder endpoint, prints
// the workspace tree, and deletes the test data (user remains, delete in
// phpMyAdmin if you want a pristine DB).
const BASE = 'https://guatermelon.com/moondash/backend/public'
const EMAIL = `folder-test-${Date.now()}@example.com`
const PASS = 'FolderTest123!'

async function req(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`)
  return data
}

let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ok  ${name}`)
  } else {
    fail++
    console.log(`FAIL  ${name} ${extra}`)
  }
}

try {
  console.log('== register ==')
  const reg = await req('POST', '/api/auth/register', null, { email: EMAIL, password: PASS })
  const token = reg.token
  check('registered', !!token)

  console.log('== workspace ==')
  const ws = await req('POST', '/api/workspaces', token, { name: 'Folder Test' })
  const wsId = ws.workspace_id
  check('workspace created', typeof wsId === 'number')

  console.log('== folders ==')
  const fRoot = await req('POST', '/api/folders', token, {
    workspace_id: wsId, name: 'Projects', color_hex: '#5B5BD6', icon_key: '🚀'
  })
  check('root folder created', typeof fRoot.folder_id === 'number')

  const fChild = await req('POST', '/api/folders', token, {
    workspace_id: wsId, name: 'Web', color_hex: '#2EA043', icon_key: '🌐', parent_folder_id: fRoot.folder_id
  })
  check('nested folder created', typeof fChild.folder_id === 'number')

  const fSibling = await req('POST', '/api/folders', token, {
    workspace_id: wsId, name: 'Notes', color_hex: '#F5A623', icon_key: null
  })
  check('sibling folder created', typeof fSibling.folder_id === 'number')

  console.log('== docs in two folders at once ==')
  const doc = await req('POST', '/api/docs', token, {
    workspace_id: wsId, relative_path: 'shared.md', content: '# Shared\n\nlives in 2 folders'
  })
  await req('POST', '/api/folders/members', token, { folder_id: fChild.folder_id, doc_id: doc.bit_id })
  await req('POST', '/api/folders/members', token, { folder_id: fSibling.folder_id, doc_id: doc.bit_id })
  check('doc added to TWO folders', true)

  console.log('== tree ==')
  const tree = await req('GET', `/api/workspaces/tree?workspace_id=${wsId}`, token)
  const folderIds = tree.folders.map((f) => f.bit_id)
  check('tree has 3 folders', folderIds.length === 3, JSON.stringify(tree.folders))
  check(
    'child folder appears under root',
    tree.memberships.some((m) => m.item_id === fChild.folder_id && m.folder_id === fRoot.folder_id)
  )
  const docRels = tree.memberships.filter((m) => m.item_id === doc.bit_id)
  check('doc has 2 memberships', docRels.length === 2, JSON.stringify(docRels))
  check('icon persisted', tree.folders.some((f) => f.bit_id === fRoot.folder_id && f.icon_key === '🚀'))

  console.log('== move folder (Notes into Projects) ==')
  await req('POST', '/api/folders/move', token, { folder_id: fSibling.folder_id, parent_folder_id: fRoot.folder_id })
  const tree2 = await req('GET', `/api/workspaces/tree?workspace_id=${wsId}`, token)
  check(
    'Notes now nested under Projects',
    tree2.memberships.some((m) => m.item_id === fSibling.folder_id && m.folder_id === fRoot.folder_id)
  )

  console.log('== cycle guard ==')
  let cycled = false
  try {
    await req('POST', '/api/folders/move', token, { folder_id: fRoot.folder_id, parent_folder_id: fChild.folder_id })
  } catch (e) {
    cycled = e.message.includes('itself')
  }
  check('moving folder into its own child rejected', cycled)

  console.log('== remove member ==')
  await req('DELETE', `/api/folders/members?folder_id=${fSibling.folder_id}&doc_id=${doc.bit_id}`, token)
  const tree3 = await req('GET', `/api/workspaces/tree?workspace_id=${wsId}`, token)
  check(
    'doc now in exactly 1 folder',
    tree3.memberships.filter((m) => m.item_id === doc.bit_id).length === 1
  )

  console.log('== update folder ==')
  await req('PATCH', '/api/folders', token, { folder_id: fSibling.folder_id, name: 'Notes v2', color_hex: '#E0245E', icon_key: '📌' })
  const tree4 = await req('GET', `/api/workspaces/tree?workspace_id=${wsId}`, token)
  const sib = tree4.folders.find((f) => f.bit_id === fSibling.folder_id)
  check('rename + recolor + icon', sib?.name === 'Notes v2' && sib?.color_hex === '#E0245E' && sib?.icon_key === '📌')

  console.log('== delete folder (children cascade, doc survives) ==')
  await req('DELETE', `/api/folders?folder_id=${fRoot.folder_id}`, token)
  const tree5 = await req('GET', `/api/workspaces/tree?workspace_id=${wsId}`, token)
  const remainingFolders = tree5.folders.filter((f) => [fRoot.folder_id, fChild.folder_id, fSibling.folder_id].includes(f.bit_id))
  check('root + nested folders deleted', remainingFolders.length === 0)
  check('doc still exists after folder delete', tree5.docs.some((d) => d.id === doc.bit_id))
  check('doc memberships cleaned', tree5.memberships.filter((m) => m.item_id === doc.bit_id).length === 0)

  console.log('== cleanup: delete docs + workspace ==')
  await req('DELETE', `/api/docs?doc_id=${doc.bit_id}`, token)
  await req('DELETE', `/api/workspaces?workspace_id=${wsId}`, token)
  console.log('test account:', EMAIL)

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
} catch (e) {
  console.error('ERROR:', e.message)
  process.exit(1)
}
