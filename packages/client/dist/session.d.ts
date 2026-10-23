/**
 * Whether signing out leaves the person outside (H-2605, UD-190, H-3720). Every source issues a session of our own and
 * `POST /api/auth/logout` closes it, but with `signed-header`, `jwt` or `trusted-header` alone the host identifies the
 * person again on the next request; there the button only exists when the host has its own sign-out (LOGOUT_URL).
 * `local` and `delegated:sso-redirect` close for good. An absent name keeps the button.
 */
export declare function canSignOut(provider: string | undefined, logoutUrl?: string | null): boolean;
