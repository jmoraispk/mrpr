import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const webDir = fileURLToPath(new URL('.', import.meta.url))

// The build this page came from, for feedback: the short commit on Vercel.
process.env.VITE_APP_VERSION ??=
  (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || 'dev'

/** The app holds OAuth tokens, so nothing but our own code may run in it. */
const APP_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
  // Any GitLab server a visitor brings, not one fixed at build time.
  "connect-src 'self' https:",
  "img-src 'self' data: https:",
  "object-src 'none'",
  "base-uri 'none'",
  'form-action https:',
].join('; ')

/**
 * The landing and privacy pages share the app's origin, and with it the stored
 * tokens, so they run only our own script file (public/landing.js: theme
 * toggle, feature tabs and the waitlist), never inline code, plus their own
 * styles and web fonts.
 */
const LANDING_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'mrpr-site-csp',
    // Dev serving injects inline scripts for hot reload; the policy is for
    // what ships.
    apply: 'build',
    transformIndexHtml: (html, context) => {
      const policy = context.path.startsWith('/app/')
        ? APP_POLICY
        : LANDING_POLICY
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      )
    },
  }
}

export default defineConfig(() => {
  return {
    root: `${webDir}site`,
    envDir: webDir,
    base: process.env.MRPR_SITE_BASE ?? '/',
    plugins: [react(), contentSecurityPolicy()],
    build: {
      outDir: `${webDir}dist-site`,
      emptyOutDir: true,
      chunkSizeWarningLimit: 1100,
      rollupOptions: {
        // The landing page owns the root; the app lives under /app/.
        input: {
          landing: `${webDir}site/index.html`,
          app: `${webDir}site/app/index.html`,
          privacy: `${webDir}site/privacy/index.html`,
        },
      },
    },
  }
})
