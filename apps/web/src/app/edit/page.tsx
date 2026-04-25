import { Suspense } from 'react'
import EditorClient from './editor-client'

export default function EditPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-neutral-500">Loading editor...</div>}>
      <EditorClient />
    </Suspense>
  )
}
