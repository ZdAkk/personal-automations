# Wohnungs-Bewerbungen — Dashboard

Paste apartment listing URLs (ImmoScout24 and Kleinanzeigen, mixed), get
ready-to-send German application letters back, streamed one at a time.

It shares the drafting code with the Trigger.dev scouts — `draftListings()` in
`src/lib/apartments/draft-from-url.ts` — so the letter has exactly one
definition in this repo. There is no duplicated wording to keep in sync.

## Run locally

    npm install                 # from the repo root (workspaces)
    npm run build -w wohnung-dashboard
    npm run dashboard           # http://127.0.0.1:8088

Frontend dev with hot reload (proxies /api to the server on 8088):

    npm run dev:server -w wohnung-dashboard   # terminal 1
    npm run dev -w wohnung-dashboard          # terminal 2 → http://127.0.0.1:5173

## Deploy (unraid, LAN-only)

    docker compose -f dashboard/docker-compose.yml up --build -d

Reachable at `http://192.168.178.40:8088`. Deliberately **not** exposed
publicly: the letters contain income, phone number and SCHUFA date.

Needs a `dashboard/.env` with `OPENROUTER_API_KEY` and
`KLEINANZEIGEN_API_TOKEN` (ImmoScout needs no credentials).

## Notes

- `KLEINANZEIGEN_API_URL` must be the host's LAN IP, not `localhost` — inside a
  container `localhost` is the container itself, where nothing is listening.
- Filters are NOT applied. Pasting a link is the decision; a listing outside
  the configured criteria is still drafted, just flagged on the card.
- ImmoScout coordinates are approximate (postcode-outline centroid), so the
  distance is a good estimate rather than exact. Kleinanzeigen details carry no
  coordinates at all, so those cards show no distance.
