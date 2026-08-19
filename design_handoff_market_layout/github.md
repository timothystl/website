repo: timothystl/website
branch: main

## Last sync
date: 2026-08-19T01:15:23Z

### Updated in this project
- Recreated the `/market` Vendors tab (tiles, four-column list, unpaid warning band) from `admin/market.js` + `admin/ui.js`.
- Redesigned the vendor table: inline editing in the row, sortable columns, category field, check-received tracking.
- Rebuilt the Volunteers tab as four views — by job, by time, grid, everybody — with printable handouts.
- Shell (sidebar, context bar, tab nav) copied from `admin/helpers.js` and `admin/ui.js` tokens.

## Screen map
| Screen | Built from |
| --- | --- |
| Market Admin.dc.html — shell + sidebar + context bar | admin/helpers.js (`sidebarShell`, `contextBar`, `ADMIN_SHELL_CSS`, `GROUPS`, `TRAIL`) |
| Market Admin.dc.html — tab nav | admin/ui.js (`TABS_CSS`), admin/market.js (`TABS`) |
| Market Admin.dc.html — Vendors (today) | admin/market.js (vendors branch, `paymentLabel`, `allApplications`), admin/ui.js (`renderListSection`, `primaryCell`, `statusPill`, `PALETTE`, `TONES`), admin/sections.js (`SECTIONS.market`) |
| Market Admin.dc.html — Vendors (proposed) | same sources; drawer fields from `renderDrawer` call in admin/market.js |
| Market Admin.dc.html — Volunteers | admin/market.js (volunteers branch, Serve `/api/signups/christmasmarket/summary` shape); shift data from user-supplied Serve screenshots |
