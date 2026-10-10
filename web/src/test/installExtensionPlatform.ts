/**
 * Import dynamically, right after the literal `vi.mock('webextension-polyfill',
 * ...)`, in any test that exercises shared code against the fake browser:
 *
 *   await import('../test/installExtensionPlatform')
 */
import { createExtensionPlatform } from '../platform/extension'
import { installPlatform } from '../platform/platform'

installPlatform(createExtensionPlatform())
