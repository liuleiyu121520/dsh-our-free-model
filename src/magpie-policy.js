/**
 * Account channels this build does not offer.
 *
 * Upstream excludes WorkBuddy (both builds) and Huawei Cloud here, because the
 * community plugin serving WorkBuddy signs requests as its own desktop client
 * and the project chose not to carry that risk. **This branch restores all of
 * them**: the deny sets below are emptied, so every filter in this module and
 * every refusal in `assertEngineMutation` is inert, and the engine's own preset
 * list and plugin market reach the user unfiltered.
 *
 * The mechanism is deliberately kept rather than deleted. It is one place that
 * answers "is this channel offered", and both surfaces (the embedded engine and
 * the desktop provider directory) read that same answer, so the two cannot
 * disagree. Restoring the channels therefore means emptying the decision, not
 * removing the code path — and a later upstream registry refresh still cannot
 * quietly re-add a channel this branch has not decided to offer, because the
 * ids and aliases are preserved below as documentation of what was once denied.
 *
 * Using these channels is the user's own responsibility; see the disclaimer in
 * `src/disclaimer.js`, which now names them as offered rather than withheld.
 */

// Restored, so nothing is denied by id. The former ids are recorded here as a
// comment for whoever wonders why this Set is empty:
//   workbuddy, workbuddy-ai, codebuddy, codebuddy-cn, huaweicloud, codearts
const DENIED_IDS = new Set()
// Likewise restored: the former alias pattern was
//   /workbuddy|codebuddy|huaweicloud|huawei[\s-]*cloud|modelarts|codearts|华为云|码道/i
// `(?!)` is a negative lookahead of the empty pattern, which fails at every
// position, so this never matches any string. Every filter below therefore
// stays structurally intact while all spellings pass through.
const DENIED_TEXT = /(?!)/
export const POLICY_REFUSED = 'This channel is not offered by this build'

/**
 * Whether an account channel is excluded from this build. Both the embedded
 * engine (via the filters below) and the desktop provider directory (via the
 * aggregate registry) answer this same question, so the two surfaces cannot
 * disagree about which channels this product offers. On this branch the answer
 * is always no, since the channels are offered.
 */
export function isDeniedChannel(id, text) {
  return deniedId(id) || deniedText(text) || deniedText(id)
}

function idOf(value) {
  return typeof value === 'string' ? value.replace(/^plugin:/i, '').replace(/-plugin$/i, '').toLowerCase() : ''
}

const deniedId = value => DENIED_IDS.has(idOf(value))
const deniedText = value => typeof value === 'string' && DENIED_TEXT.test(value)
const deniedAny = list => Array.isArray(list) && list.some(value => deniedId(value) || deniedText(value))
const deniedListing = listing => deniedText(listing?.package) || deniedAny(listing?.providers)
const deniedEntry = entry => deniedText(entry?.spec) || deniedText(entry?.package) ||
  deniedText(entry?.name) || deniedAny(entry?.providers) || deniedAny(entry?.moved)
const deniedSub = sub => deniedId(sub?.pid) || deniedId(sub?.id) || deniedText(sub?.spec) || deniedText(sub?.name)
const deniedCard = card => deniedId(card?.provider) || deniedId(card?.agent)

function filterPluginsState(state) {
  if (!state || typeof state !== 'object') return state
  if (Array.isArray(state.plugins)) state.plugins = state.plugins.filter(entry => !deniedEntry(entry))
  if (Array.isArray(state.movable)) state.movable = state.movable.filter(row => !deniedId(row?.id))
  return state
}

function filterProviders(state) {
  if (!state || typeof state !== 'object') return state
  // The pinned preset list is where Huawei Cloud's Token Plan would otherwise
  // reappear as an addable vendor; an account already added keeps working and
  // stays listed, so only the way onto the channel is withdrawn.
  if (Array.isArray(state.presets)) {
    state.presets = state.presets.filter(preset => !deniedId(preset?.id) && !deniedText(preset?.name)
      && !deniedText(preset?.short))
  }
  // An account already signed in keeps working and stays listed; only its way
  // onto the excluded plugin is withdrawn.
  for (const provider of Array.isArray(state.providers) ? state.providers : []) {
    if (deniedText(provider?.move?.package)) delete provider.move
  }
  if (Array.isArray(state.plugins)) state.plugins = state.plugins.filter(sub => !deniedSub(sub))
  if (Array.isArray(state.unmoved)) state.unmoved = state.unmoved.filter(row => !deniedId(row?.id))
  if (Array.isArray(state.onPlugins)) state.onPlugins = state.onPlugins.filter(id => !deniedId(id))
  if (state.movesTo && typeof state.movesTo === 'object') {
    for (const id of Object.keys(state.movesTo)) if (deniedId(id)) delete state.movesTo[id]
  }
  // state.movable is kept whole on purpose: the page reads it to decide a
  // built-in is deprecated and hidden, so dropping the id would surface the very
  // tile it is meant to hide. The way *onto* it is withdrawn above (`movesTo`,
  // `plugins`, `unmoved`), which is what a user can act on.
  return state
}

/** Vendor-status answers are keyed by provider id, so the excluded id goes too. */
function filterUpstream(body) {
  if (!body || typeof body !== 'object' || !body.providers || typeof body !== 'object') return body
  for (const id of Object.keys(body.providers)) if (deniedId(id) || deniedText(id)) delete body.providers[id]
  return body
}

/**
 * Third-party prose can name the excluded channels without offering them: a
 * market listing for an unrelated plugin may mention that it can read the
 * session files of "WorkBuddy and CodeBuddy". The structural filters above
 * rightly keep such a plugin, but the names still must not reach the user, so
 * every string of a third-party answer has them rewritten out. Id-bearing
 * surfaces (/api/providers, /api/upstream, /api/importapps) are exempt — the
 * deprecation list and the add sheet need the exact ids to stay whole.
 */
const DENIED_TEXT_GLOBAL = new RegExp(DENIED_TEXT.source, 'gi')
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/
const redactString = value => DENIED_TEXT.test(value)
  ? value.replace(DENIED_TEXT_GLOBAL, CJK.test(value) ? '某桌面编码工具' : 'a desktop coding tool')
  : value
function redactExcludedNames(value) {
  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) value[index] = redactExcludedNames(value[index])
    return value
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) value[key] = redactExcludedNames(value[key])
    return value
  }
  return value
}
const redacted = filter => body => redactExcludedNames(filter(body))

const RESPONSE_FILTERS = {
  '/api/plugins/listings': redacted(body => {
    if (Array.isArray(body.listings)) body.listings = body.listings.filter(listing => !deniedListing(listing))
    return body
  }),
  '/api/plugins/market': redacted(body => {
    if (Array.isArray(body.listings)) body.listings = body.listings.filter(listing => !deniedListing(listing))
    filterPluginsState(body.state)
    return body
  }),
  '/api/plugins': redacted(body => {
    if (Array.isArray(body.plugins)) body.plugins = body.plugins.filter(entry => !deniedEntry(entry))
    return body
  }),
  '/api/plugins/check': redacted(body => {
    if (Array.isArray(body.plugins)) {
      body.plugins = body.plugins.filter(row => !deniedText(row?.spec) && !deniedText(row?.package))
    }
    filterPluginsState(body.state)
    return body
  }),
  '/api/plugins/updates': redacted(body => {
    if (Array.isArray(body.waiting)) {
      body.waiting = body.waiting.filter(row => !deniedText(row?.spec) && !deniedText(row?.package))
    }
    if (Array.isArray(body.updated)) body.updated = body.updated.filter(row => !deniedText(row?.package))
    return body
  }),
  '/api/plugins/search': redacted(body => {
    if (Array.isArray(body.hits)) body.hits = body.hits.filter(hit => !deniedText(hit?.package))
    return body
  }),
  '/api/plugins/npm': redacted(body => {
    if (body.npm && typeof body.npm === 'object') {
      for (const name of Object.keys(body.npm)) if (deniedText(name)) delete body.npm[name]
    }
    return body
  }),
  '/api/plugins/github': redacted(body => {
    if (Array.isArray(body.repos)) {
      body.repos = body.repos.filter(repo => !deniedText(repo?.package) &&
        !deniedText(repo?.spec) && !deniedText(repo?.repo))
    }
    return body
  }),
  '/api/providers': filterProviders,
  '/api/upstream': filterUpstream,
  '/api/plugin-pages': redacted(body => Array.isArray(body) ? body.filter(page => !deniedText(page?.spec)) : body),
  '/api/plugin-panels': redacted(body => Array.isArray(body) ? body.filter(panel => !deniedText(panel?.spec)) : body),
  '/api/login/usage': body => Array.isArray(body) ? body.filter(card => !deniedCard(card)) : body,
  '/api/usage/quotas': body => Array.isArray(body) ? body.filter(card => !deniedCard(card)) : body,
  '/api/importapps': body => Array.isArray(body)
    ? body.map(source => ({
      ...source,
      items: Array.isArray(source?.items) ? source.items.filter(item => !deniedId(item?.provider?.id)) : [],
    })) : body,
}

/** Whether an engine response for this route has to be rewritten. */
export function policyResponse(pathname) {
  return Object.hasOwn(RESPONSE_FILTERS, pathname)
}

/** The same answer with the excluded channel left out; other routes pass through. */
export function filterEngineJSON(pathname, value) {
  const filter = RESPONSE_FILTERS[pathname]
  if (!filter || !value || typeof value !== 'object') return value
  return filter(value) ?? value
}

/** A plugin detail page is a lookup by name, refused before the engine is asked. */
export function deniedLookup(pathname, params) {
  return pathname === '/api/plugins/page' && deniedText(params?.get?.('name'))
}

/**
 * A gateway model row serving the excluded channel. Its provider is the row's
 * `owned_by`; the id carries it too for a namespaced listing.
 */
export function deniedModel(row) {
  return deniedId(row?.owned_by) || deniedText(row?.owned_by) || deniedText(row?.id)
}

// Turning the channel off and removing it stay open: a plugin installed before
// this change has to be removable, or hiding it would trap it.
const PLUGIN_OPS = /^\/api\/plugins\/(?:add|upgrade|options|prefer)$/
const MUTATION_ROUTES = [
  PLUGIN_OPS,
  /^\/api\/plugins\/off$/,
  /^\/api\/plugin-signin(?:\/prompt)?$/,
  /^\/api\/signin(?:\/import)?$/,
  /^\/api\/login\/[^/]+$/,
  /^\/api\/provider\/(?:move|moveback|save)$/,
]

/**
 * Whether this route's request body decides if the channel is involved. These
 * are the only bodies buffered before forwarding; every other request streams.
 */
export function policyMutation(method, pathname) {
  const verb = String(method || 'GET').toUpperCase()
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return false
  return MUTATION_ROUTES.some(route => route.test(pathname))
}

/** Refuses an engine mutation that would install, enable or sign in the channel. */
export function assertEngineMutation(method, pathname, input) {
  const verb = String(method || 'GET').toUpperCase()
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return
  const body = input && typeof input === 'object' && !ArrayBuffer.isView(input) ? input : {}
  const refuse = () => { throw Object.assign(new Error(POLICY_REFUSED), { statusCode: 403 }) }
  if (PLUGIN_OPS.test(pathname) && deniedText(body.spec)) refuse()
  // Re-enabling is a way in; switching off is the way out and stays allowed.
  if (pathname === '/api/plugins/off' && body.off === false && deniedText(body.spec)) refuse()
  if (/^\/api\/plugin-signin(?:\/prompt)?$/.test(pathname) && deniedId(body.provider)) refuse()
  if ((pathname === '/api/signin' || pathname === '/api/signin/import') && deniedId(body.agent)) refuse()
  if (/^\/api\/login\/[^/]+$/.test(pathname) && deniedId(body.agent)) refuse()
  if (/^\/api\/provider\/(?:move|moveback)$/.test(pathname) && deniedId(body.id)) refuse()
  // A save built from an excluded preset, or one naming the channel itself,
  // is the other way onto it.
  if (pathname === '/api/provider/save' && (deniedId(body.preset) || deniedId(body.id) || deniedText(body.name))) refuse()
}
