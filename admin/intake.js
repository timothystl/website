// Event types and rooms shared by Calendar & events.
//
// This file used to be the whole engine behind a separate "Event Intake" /
// "Office follow-up" screen — a three-pane triage queue with its own
// checklist and extra-field matrix per type, sitting alongside the Calendar
// tab and editing the same room/type fields. Andrew: "i just think this
// isn't useful" — once Calendar & events (admin/calendar-google.js,
// admin/workspace.js) started editing a local event's room and office type
// directly, that second screen had nothing left to do except duplicate it,
// plus a 44-item checklist/extra-field matrix (11 types × 4 items × 4
// fields) nobody was actually filling in. It is retired — see
// website-admin-worker.js's schema notes for where the one piece worth
// keeping (a confirmed rental's own paperwork trail) went instead: onto the
// gym_bookings row itself, in admin/gym.js.
//
// TYPES/ROOMS survive because they are still real, still-used ideas:
// admin/workspace.js's own "Add/Edit calendar event" form offers both for a
// locally-entered event, and admin/calendar.js maps a local event's `type`
// onto a public-calendar color (INTAKE_TYPE_TO_CATEGORY) the same way it
// always has. Nothing below writes or reads `event_intake.checks_json`,
// `extra_json` or `published_at` any more — those columns are dead weight
// on an existing row, left alone rather than migrated, since dropping a
// column is not something worth a schema pass for data nothing reads.

// ── THE ELEVEN TYPES ─────────────────────────────────────────────────────────
// Andrew asked for seven more once he was actually working the old triage
// queue — Meetings, Word of Life, MDO, Music, Youth & Family, Special event,
// Fellowship — on top of the original four (Worship/Education/Rental/News).
// That history is why there are eleven rather than a rounder number; nothing
// here still depends on the queue that grew them.
//
// ⚠ COLORS ARE `CALENDAR_PALETTE` KEYS, NOT HAND-PICKED HEXES — reused from
// the calendar's own contrast-verified swatch keys (worship→navy, learn→teal,
// facility→stone, youth→amber, wol→slate, mdo→sand, music→plum,
// meetings→steel, special→gold) rather than inventing an ad hoc color system
// for one more picker. `news` and `fellowship` have no calendar-category
// equivalent, so they take the two CALENDAR_PALETTE keys ('moss', 'brick')
// nothing else here uses; 'gray' is left alone, since on the calendar it
// means "uncategorized" and no type here is that.
export const TYPES = {
  worship: {
    key: 'worship', label: 'Worship', color: '#1E2D4A', palette: 'navy',
    note: 'Goes on the Worship calendar and into the bulletin build.',
  },
  education: {
    key: 'education', label: 'Education', color: '#276C8E', palette: 'teal',
    note: 'Adult Bible classes and studies — anything with a teacher and a room that is not Youth & Family, WOL or MDO.',
  },
  youth: {
    key: 'youth', label: 'Youth & Family', color: '#93571F', palette: 'amber',
    note: 'Sunday School, VBS, family events — anything the Youth Director runs.',
  },
  wol: {
    key: 'wol', label: 'Word of Life', color: '#3A4E5C', palette: 'slate',
    note: 'Word of Life School on our campus or calendar — chapel, programs, joint use.',
  },
  mdo: {
    key: 'mdo', label: 'MDO', color: '#776422', palette: 'sand',
    note: "Timothy's Mother's Day Out — chapel time, programs, and parent events.",
  },
  music: {
    key: 'music', label: 'Music', color: '#7A5A7A', palette: 'plum',
    note: 'Choir, handbells, cantors, special music — feeds the worship calendar.',
  },
  rental: {
    key: 'rental', label: 'Rental', color: '#68655F', palette: 'stone',
    note: 'Outside groups and building use.',
  },
  fellowship: {
    key: 'fellowship', label: 'Fellowship', color: '#8C3A28', palette: 'brick',
    note: 'Potlucks, socials, coffee hour extras — building community, not a class.',
  },
  meetings: {
    key: 'meetings', label: 'Meetings', color: '#576876', palette: 'steel',
    note: 'Council, elders, committees, staff meetings — nothing publicly facing.',
  },
  special: {
    key: 'special', label: 'Special event', color: '#646B1F', palette: 'gold',
    note: 'Christmas Market, VBS kickoff, one-off congregational events — the big ones.',
  },
  news: {
    key: 'news', label: 'News', color: '#4A5E3A', palette: 'moss',
    note: 'Needs a description, photo, or signup — the richer record wins on the public calendar.',
  },
};
export const TYPE_KEYS = Object.keys(TYPES);

// A type an event has never been given. Not one of TYPES on purpose — an
// unclassified event is not a twelfth kind of event, it is the absence of a
// choice that is always optional.
export const UNCLASSIFIED = null;

// ── ROOMS ─────────────────────────────────────────────────────────────────
export const ROOMS = ['Sanctuary', 'Gym', 'Youth Room', '3rd Floor Classroom', 'Multipurpose Room', 'Kitchen', 'Parking Lot'];
