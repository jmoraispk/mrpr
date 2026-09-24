import browser from 'webextension-polyfill'

/** The brand accent, so the count reads as Delta's rather than an error. */
const BADGE_COLOR = '#aa3bff'

export async function showUnread(count: number): Promise<void> {
  await browser.action.setBadgeBackgroundColor({ color: BADGE_COLOR })
  await browser.action.setBadgeText({
    text: count === 0 ? '' : count > 99 ? '99+' : String(count),
  })
}
