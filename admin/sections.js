// ── SECTION CONFIG, FROM THE DESIGN HANDOFF ──────────────────
// Lifted verbatim from `SECTIONS` in the prototype
// (design_handoff_admin_overhaul/Admin Sections Prototype.dc.html), which is
// the authoritative source for what each screen says — the screenshots are a
// rendering of this, not the other way round.
//
// It lives here as data, and every route reads its title, purpose line, action
// label, search placeholder, filters, column widths and `◆` note from it. That
// is deliberate: the first pass at this overhaul wrote those strings by hand
// from the README's prose, and nearly every one of them drifted from the
// design — wrong filter sets, invented column layouts, notes nobody had
// approved. Config in one place, checked by a test, is what stops that
// happening twice.
//
// If a screen needs to say something different, change it HERE, not in the
// route. admin/sections.test.mjs asserts the two cannot diverge.

export const SECTIONS = {
  dashboard: { label: 'Dashboard', glyph: '◧', title: 'Thursday morning', purpose: 'What needs you today, what happens Sunday, and what changed since yesterday.', variants: [['a', 'Needs you'], ['b', 'Overview']] },
  pages: {
    label: 'Pages', glyph: '▤', title: 'Pages', purpose: 'Every page on the site except the ministry pages, which have their own tab. Opening a row goes straight to the page editor.',
    action: '+ New page', search: 'Search pages', filters: ['All', 'Live', 'Draft edits', 'Not in menu'],
    columns: [['Page', '2.1fr'], ['Address', '1.5fr'], ['Short link', '1.1fr'], ['Status', '1.1fr']],
    openMode: 'editor',
    note: 'Short links are generated automatically from the last part of the address, so /visit works as well as /plan-a-visit. Conflicts are flagged rather than guessed at.'
  },
  partners: {
    label: 'Partners', glyph: '⚭', title: 'Partner ministries', purpose: 'Four partners, one for each of our values — from our neighbourhood to the nations. This is both the page visitors see and the menu item under Ministries.',
    action: '+ Add partner', search: 'Search partners', filters: ['All'],
    columns: [['Partner', '2.7fr'], ['Value', '.9fr'], ['Their site', '1.3fr']],
    openMode: 'editor',
    note: 'One partner per value keeps the page honest — if a value has no partner, the page says so rather than quietly showing three.'
  },
  menu: {
    label: 'Menu', glyph: '☰', title: 'Menu', purpose: 'The order and shape of the header and footer. Items can point at a page, an outside site, or a short link — and the label in the bar can be shorter than the page name.',
    action: '+ Add item'
  },
  newsletter: {
    label: 'Newsletter', glyph: '✎', title: 'Newsletter', purpose: 'Weekly issues, assembled from news posts, events, and Bible classes already in the admin — then approved and sent.',
    action: '+ New issue', search: 'Search issues', filters: ['All', 'Draft', 'Awaiting approval', 'Sent'],
    columns: [['Issue', '2.4fr'], ['Sends', '1fr'], ['Date', '1.1fr'], ['Status', '1.2fr']],
    note: 'An issue pulls from News & Events and Christian Ed rather than asking you to retype them — change a post and the unsent issue follows.'
  },
  news: {
    label: 'News & Events', glyph: '◫', title: 'News & Events', purpose: 'One list behind one page — announcements and dated events together, with the calendar embedded below them. Posts here also get pulled into the weekly email. Pinned items stay on top; expired ones drop off on their own.',
    action: '+ New post', search: 'Search posts', filters: ['All', 'Live', 'Scheduled', 'Expired'],
    columns: [['Post', '2.4fr'], ['Published', '1fr'], ['Expires', '1fr'], ['Status', '1.1fr']],
    note: 'Expiry is what keeps the site honest — a post with an expire date disappears without anyone remembering to delete it.'
  },
  ministries: {
    label: 'Ministries', glyph: '◈', title: 'Ministry pages', purpose: 'Eleven ministry pages, split out from Pages because different people own them and some carry posts. Clicking a row opens the editor.',
    action: '+ New ministry', search: 'Search ministries', filters: ['All', 'With posts', 'Draft edits', 'Not in menu'],
    columns: [['Ministry', '2.3fr'], ['Short link', '1.1fr'], ['In menu', '.7fr'], ['Status', '1fr']],
    openMode: 'editor',
    note: 'The In menu switch takes a ministry out of the header without unpublishing it — the page stays live at its address, it just stops being listed. Short links work either way: /youth and /ministries/youth land in the same place.'
  },
  sermons: {
    label: 'Sermons', glyph: '♪', title: 'Sermons', purpose: 'Series, and the sermons inside them. One series is the active one shown on the site.',
    action: '+ New series', search: 'Search series & sermons', filters: ['All', 'Active series', 'Missing media'],
    columns: [['Series / sermon', '2.4fr'], ['Date', '1fr'], ['Scripture', '1.2fr'], ['Media', '1fr']],
    note: 'No recordings are attached yet, so the site shows text-only cards. Add a YouTube link to any sermon and it upgrades itself.'
  },
  ed: {
    label: 'Christian Ed', glyph: '✎', title: 'Christian Education', purpose: 'Bible classes and Sunday School offerings, in the order they appear on the education page.',
    action: '+ New class', search: 'Search classes', filters: ['All', 'Running', 'Paused'],
    columns: [['Class', '2.3fr'], ['Schedule', '1.6fr'], ['Leader', '1fr'], ['Status', '1fr']]
  },
  notices: {
    label: 'Notices', glyph: '❢', title: 'Notices', purpose: 'Short banners pinned to a specific page — a closure, a schedule change, a registration deadline.',
    action: '+ New notice', search: 'Search notices', filters: ['All', 'Showing', 'Hidden'],
    columns: [['Notice', '2.4fr'], ['On page', '1.4fr'], ['Position', '.8fr'], ['Status', '1fr']],
    note: 'A notice is deliberately not a page block: it can be switched off in one click without touching the page it sits on.'
  },
  links: {
    label: 'NFC Taps\n', glyph: '⛓', title: 'Taps & links', purpose: 'Four NFC taps, each with its own set of link cards. Re-point a tap here and the physical tag keeps working — nothing is reprogrammed.',
    action: '+ New card', search: 'Search cards', filters: ['All', 'Showing', 'Hidden'],
    columns: [['Card', '2.4fr'], ['Goes to', '2fr'], ['Order', '.7fr'], ['Status', '1fr']],
    note: 'The tag itself only ever holds its short address — /tap1 through /tap4. Everything a visitor sees is these cards, so a tap printed a year ago can point somewhere new today.'
  },
  staff: {
    label: 'Staff', glyph: '☺', title: 'Staff directory', purpose: 'One record per person. Every page that shows staff reads from here — edit once, and the whole site follows.',
    action: '+ Add person', search: 'Search staff', filters: ['All', 'On the website', 'Hidden'],
    columns: [['Person', '2.2fr'], ['Email', '1.8fr'], ['Order', '.7fr'], ['Photo', '1fr']],
    note: 'Photo crop is set per person and reused everywhere — no more heads cut off on the About page.'
  },
  gym: {
    label: 'Gym Rentals', glyph: '⛹', title: 'Gym rentals', purpose: 'Groups book through their own portal link. Holds lapse in 48 hours; recurring requests wait for you; invoices bill at the hourly rate from settings.',
    action: '+ Add booking', variants: [['a', 'Calendar first'], ['b', 'Queue first']]
  },
  users: {
    label: 'Users', glyph: '⚿', title: 'Users', purpose: 'Who can get into this admin, and exactly what each of them can reach.',
    action: '+ New user', search: 'Search users', filters: ['All', 'Active', 'Disabled'],
    columns: [['User', '1.8fr'], ['Access', '1.8fr'], ['Last login', '1.2fr'], ['Status', '1fr']],
    note: 'Presets are just shortcuts — the checkboxes are the truth, and they map one-to-one to the permission names in the code.'
  },
  subscribers: {
    label: 'Subscribers', glyph: '✉', title: 'Subscribers', purpose: 'People signed up for the weekly email, whether they joined on the website or were added by the office.',
    action: 'Import CSV', search: 'Search by email or name', filters: ['All', 'Website', 'Added by office', 'Bounced'],
    columns: [['Person', '2.2fr'], ['Source', '1.2fr'], ['Joined', '1.2fr'], ['Status', '1fr']],
    note: 'Read-only mirror of the mail provider plus local signups. Unsubscribes come back from the provider — never delete by hand to remove someone.'
  },
  redirects: {
    label: 'Redirects', glyph: '⇥', title: 'Redirects', purpose: 'Short links you can say out loud — timothystl.org/zoom — and the 301s written automatically when a page address changes.',
    action: '+ New redirect', search: 'Search redirects', filters: ['All', 'Hand-made', 'Automatic', 'Off'],
    columns: [['Short link', '1.6fr'], ['Goes to', '2.4fr'], ['Kind', '1fr'], ['Status', '1fr']],
    note: 'Automatic rows are created when a page is renamed. Leave them — they are what keeps old bulletins and Google results working.'
  },
  giving: { label: 'Giving', glyph: '♡', title: 'Giving', purpose: 'The giving page itself, the amounts and funds offered on it, and the single platform link every other screen reads.' },
  payroll: { label: 'Payroll', glyph: '▤', title: 'Payroll', purpose: 'Enter hours and exceptions, approve the period, then print the gross-pay report — church staff and Timothy MDO, with a combined total. Withholding, taxes, and bank details stay with the payroll service.' },
  media: {
    label: 'Media', glyph: '▨', title: 'Media', purpose: 'Every photo and file on the site, in one place — with the two things that go wrong: files too big, and photos with no alt text.',
    action: 'Upload', search: 'Search by filename', filters: ['All', 'Photos', 'Files', 'Needs alt text', 'Over 1 MB', 'Unused'],
    columns: [['File', '1.9fr'], ['Alt text', '2.1fr'], ['Size', '.7fr']],
    note: 'Images are resized on upload so nothing stored is over 1 MB, and alt text is asked for then — while somebody still knows what the photo shows.'
  },
  settings: {
    label: 'Settings', glyph: '⚙', title: 'Settings', purpose: 'The handful of values the rest of the site reads. Change one here and every page, email, and invoice follows.',
    search: 'Search settings', filters: ['All', 'Church details', 'Links', 'Gym rentals', 'Notifications'],
    columns: [['Setting', '1.5fr'], ['Value', '2.5fr']],
    note: 'These are the real keys in site_settings. Anything not listed here is theme-owned and lives in code on purpose.'
  },
  audit: {
    label: 'Audit Log', glyph: '◷', title: 'Audit log', purpose: 'Every change, who made it, and what it looked like before. Any row can be rolled back.',
    search: 'Search by person, action, or thing', filters: ['All', 'Content', 'People & ops', 'Rolled back'],
    columns: [['Change', '2.6fr'], ['Who', '1.1fr'], ['When', '1.2fr'], ['', '.9fr']]
  }
};

// The section a route is rendering, by its key. Throws rather than returning a
// default: a typo'd key silently producing an empty title is exactly the class
// of drift this file exists to prevent.
export function section(key) {
  const s = SECTIONS[key];
  if (!s) throw new Error(`Unknown admin section: ${key}`);
  return s;
}

// Turns the config's [label, width] pairs into the shape renderListSection
// wants, so a route never restates a column or its width.
export function columnsOf(key) {
  return (section(key).columns || []).map(([label, width]) => ({ label, width }));
}

// Filters come out of the config as plain labels; the value each one filters on
// is the label lowercased with spaces hyphenated, so 'Draft edits' → 'draft-edits'.
// The first filter is always 'All' and maps to 'all'.
export function filtersOf(key) {
  return (section(key).filters || []).map((label) => ({
    label,
    value: label === 'All' ? 'all' : label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  }));
}
