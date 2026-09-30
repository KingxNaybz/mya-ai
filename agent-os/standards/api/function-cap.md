# Vercel 12-Function Cap

`api/` is at the Hobby plan limit (12 files). Never add a new file under `api/`.

- New capability → first a `?type=` branch on the closest existing endpoint (e.g. `command-center-projects?type=alerts`)
- Mya capability → a `SKILLS` entry in `command-center-ask-mya.ts`
- Shared helpers go in `lib/` (not counted); small helpers may be duplicated with a comment saying why (e.g. `getServicesStatus`)
