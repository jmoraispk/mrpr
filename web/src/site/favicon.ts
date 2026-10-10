/** The tab icon gains a dot while anything is unread. */
export function showFaviconDot(on: boolean): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) return
  link.setAttribute(
    'href',
    `${import.meta.env.BASE_URL}${on ? 'favicon-unread.svg' : 'favicon.svg'}`,
  )
}
