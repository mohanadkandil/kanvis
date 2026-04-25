import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@kanvis/core'],
  async headers() {
    return [
      {
        // editor.js is rebuilt on every change to packages/core/src/editor-script.ts.
        // Tell browsers to always revalidate — staleness here means "AI applied
        // a change but nothing happened in the iframe", which is brutal to debug.
        source: '/editor.js',
        headers: [
          { key: 'Cache-Control', value: 'no-store, must-revalidate' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
        ],
      },
    ]
  },
}

export default config
