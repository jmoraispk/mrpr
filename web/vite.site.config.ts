import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'

const webDir = fileURLToPath(new URL('.', import.meta.url))

/** The app holds OAuth tokens, so nothing but our own code may run in it. */
function appPolicy(host: string): string {
  const gitlab = `https://${host}`
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
    `connect-src 'self' ${gitlab}`,
    `img-src 'self' data: ${gitlab}`,
    "object-src 'none'",
    "base-uri 'none'",
    `form-action ${gitlab}`,
  ].join('; ')
}

/**
 * The landing page shares the app's origin, and with it the stored tokens, so
 * it may run no script at all. It only needs its own styles and web fonts.
 */
const LANDING_POLICY = [
  "default-src 'self'",
  "script-src 'none'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function contentSecurityPolicy(host: string): Plugin {
  return {
    name: 'mrpr-site-csp',
    // Dev serving injects inline scripts for hot reload; the policy is for
    // what ships.
    apply: 'build',
    transformIndexHtml: (html, context) => {
      const policy = context.path.startsWith('/app/')
        ? appPolicy(host)
        : LANDING_POLICY
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      )
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, webDir, 'VITE_')
  const host = env.VITE_GITLAB_HOST?.trim() || 'gitlab-master.nvidia.com'
  return {
    root: `${webDir}site`,
    envDir: webDir,
    base: process.env.DELTA_SITE_BASE ?? '/',
    plugins: [react(), contentSecurityPolicy(host)],
    // DevReload references the extension's dev flag; the site never has it.
    define: { __DELTA_DEV__: 'false' },
    build: {
      outDir: `${webDir}dist-site`,
      emptyOutDir: true,
      chunkSizeWarningLimit: 1100,
      rollupOptions: {
        // The landing page owns the root; the app lives under /app/.
        input: {
          landing: `${webDir}site/index.html`,
          app: `${webDir}site/app/index.html`,
        },
      },
    },
  }
})
