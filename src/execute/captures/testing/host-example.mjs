// A host adapter for the tests: signs in against a local server with a token that goes to sessionStorage, as the real ones do.
export default {
  flags: ['account'],
  guard: { browserPosts: [/^\/auth\/files$/], blockedGets: [/\/secret$/], sessionPosts: { login: /^\/auth\/login$/ } },
  mask: { patterns: [/\b\d{1,2}\.\d{3}\.\d{3}-[\dkK]\b/], personKey: /^(full_name|email|id_number)$/i, personContext: /patient/i },
  loadingText: /(^|\n)\s*Loading/,
  expiredText: /session ended/i,
  async session ({ options, api, fail }) {
    const login = await api('/auth/login', { method: 'POST', body: { account: options.account ?? 'reader', password: process.env.TEST_PASSWORD }, permit: [/^\/auth\/login$/] })
    if (login.status === 429) fail(`the server limits the attempts (429, retry in ${login.retryAfter ?? '?'} s)`)
    if (login.status !== 200) fail(`the server did not let ${options.account ?? 'reader'} in (${login.status})`)
    return { as: `${options.account ?? 'reader'}, read only`, init: { sessionStorage: { token: login.data.token } } }
  }
}
