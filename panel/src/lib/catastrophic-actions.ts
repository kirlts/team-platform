/**
 * The only actions where the person types a name to confirm (soft-lock class 3, TP-03): the ones that empty the whole team. Everything else that
 * cannot be undone asks for one step (`ConfirmAction`), and what can be undone asks for nothing and offers Deshacer (UD-253).
 */
export const CATASTROPHIC_ACTIONS = ['reset.everything'] as const

export type CatastrophicAction = (typeof CATASTROPHIC_ACTIONS)[number]

/** The typed text names the object: the same words, without the spaces at the ends and whatever the case. */
export function namesTheObject(typed: string, name: string): boolean {
  const wanted = name.trim().toLocaleLowerCase()
  return wanted !== '' && typed.trim().toLocaleLowerCase() === wanted
}
