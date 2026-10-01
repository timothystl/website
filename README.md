# Timothy Church Website

Public church website and Website Admin for Timothy Lutheran Church: pages and navigation,
newsletters, calendar, public forms, Christmas Market, gym rentals, public giving links, and the
current payroll backend. People and Giving are owned by Connect; childcare by myMDO; Finance
(`timothystl/finance`) relays payroll to this repository.

Three Cloudflare Workers, all deployed from this repository: `timothy-website` (public site),
`timothy-website-admin` (Admin), and `timothy-links`. A push or merge to `main` releases all three.

Start with [AGENTS.md](AGENTS.md). Current references:

- [Architecture](docs/ARCHITECTURE.md) and [decisions](docs/adr/)
- [Local development](docs/DEVELOPMENT.md) and [testing](docs/TESTING.md)
- [Data ownership](docs/DATA-OWNERSHIP.md)
- [Operations](docs/OPERATIONS.md), [secrets and settings](docs/SECRETS.md), [security](docs/SECURITY.md)
- [Website-to-Connect recovery](docs/CHMS_FORWARD_RECOVERY.md)
- [Open work](docs/OPEN-WORK.md)
