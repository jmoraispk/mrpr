import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'

const webDir = fileURLToPath(new URL('.', import.meta.url))

/** The page holds OAuth tokens, so nothing but our own code may run in it. */
function contentSecurityPolicy(host: string): Plugin {
  const gitlab = `https://${host}`
  const policy = [
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
  return {
    name: 'delta-site-csp',
    // Dev serving injects inline scripts for hot reload; the policy is for
    // what ships.
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      ),
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
    },
  }
})
