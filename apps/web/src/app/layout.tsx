import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Kanvis — live edit on the fly',
  description: 'Paste any URL, edit it visually, share what you would change.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        {children}
      </body>
    </html>
  )
}
