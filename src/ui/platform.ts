export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** Modifier-key label for tooltips/shortcuts: ⌘ on Mac, Ctrl elsewhere. */
export const MOD = isMac ? '⌘' : 'Ctrl'
export const SHIFT = isMac ? '⇧' : 'Shift'

export function combo(...keys: string[]): string {
  return keys.join(isMac ? '' : '+')
}
