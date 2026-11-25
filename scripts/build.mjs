import { copyFile, cp, mkdir } from 'node:fs/promises'
import { build } from 'esbuild'

const output = 'dist/client'
await mkdir(output, { recursive: true })
await build({
  entryPoints: ['client/main.tsx'],
  outfile: output + '/assets/app.js',
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  target: 'es2022',
  minify: true,
  // The phone bezel is referenced from style.css and emitted next to app.css.
  loader: { '.png': 'file' },
  define: { 'process.env.NODE_ENV': '"production"' },
})
await copyFile('index.html', output + '/index.html')
await cp('client/ui/portraits', output + '/assets', { recursive: true })
