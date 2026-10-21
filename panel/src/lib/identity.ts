/**
 * Whether the server has a sign-out route for the identity provider that `/api/me` names (H-2605, UD-190).
 * `local` closes its own session and so does `delegated:sso-redirect`; the other delegated modes (`signed-header`, `jwt`,
 * `trusted-header`) have no session of their own and `POST /api/auth/logout` answers 404. An absent name keeps the button.
 */
export function canSignOut(provider: string | undefined): boolean {
  return provider === undefined || provider === 'local' || provider === 'delegated:sso-redirect'
}
