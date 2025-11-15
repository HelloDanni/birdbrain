# Birdbrain

Birdbrain helps you uncover eBird hotspots tailored to your mood—roll with a surprise pick, spotlight the most active haunts, or chase recent notable sightings—all without ever exposing your API key.

## Prerequisites

- Node.js 20+
- An eBird API token (request one at https://ebird.org/api/keygen)

## Environment variables

Create a `.env` file at the project root before running any scripts:

```bash
cp .env.example .env
```

Then edit `.env` and set:

```
EBIRD_API_KEY=your_real_token
PORT=4000            # optional; defaults to 4000
CLIENT_ORIGIN=http://localhost:5173  # optional; lock CORS for production
VITE_API_BASE_URL=https://your-production-api.example/api  # optional; required for static hosting such as GitHub Pages
```

> [!] Never commit the `.env` file - `.gitignore` already excludes it.

## Install dependencies

```bash
npm install
cd client && npm install
```

## Development workflow

```bash
npm run dev
```

This launches:

- Express API on port 4000 (`/api/...` routes, hides the eBird key)
- Vite dev server on port 5173 (front-end). A proxy is configured so calls to `/api` from the browser hit the local Express server without extra configuration.

## Building for production

```bash
npm run build
```

- Builds the React client into `client/dist`
- You can then start the API with `npm start`, which also serves the compiled front-end.

## Deploying to GitHub Pages

> GitHub Pages only hosts the static client. You still need to deploy the Express API (Render, Fly, Railway, etc.) and set `CLIENT_ORIGIN` to the Pages URL so CORS remains locked down.

1. Deploy the Express API somewhere HTTPS-accessible and note its `/api` URL.
2. In your repository settings, open **Secrets and variables → Actions** and add a secret named `VITE_API_BASE_URL` that points to the deployed API (for example `https://birdbrain-api.onrender.com/api`). The GitHub Actions workflow injects this value at build time so the client talks to the remote API.
3. In **Settings → Pages**, choose **GitHub Actions** as the source.
4. Push to `main` (or trigger the workflow manually). `.github/workflows/deploy.yml` installs dependencies, runs `npm run build:client` with GitHub Pages-aware asset paths, and publishes `client/dist` via `actions/deploy-pages`.

After the first successful run, Pages will be available at `https://<username>.github.io/Birdbrain/`. Update the `CLIENT_ORIGIN` environment variable on your API host to this URL so browser requests are allowed in production.

## API summary

| Route | Description |
| --- | --- |
| `GET /api/hotspots/random` | Returns a random hotspot inside `distanceKm` (1-500 km) of the provided `lat/lng` or `postalCode`. Includes 7-day activity metrics gathered from the official `/data/obs/{locId}/recent` endpoint. |
| `GET /api/hotspots/top` | Returns the top 5 hotspots ranked by `(checklists x 2) + observations` collected from the last 7 days. Accepts the same location query parameters. |
| `GET /api/hotspots/notable` | Returns the top 5 hotspots that recorded the most notable (rare/unusual) observations in the past 7 days within the requested radius. |

Each request must supply either `lat` and `lng` **or** `postalCode`. ZIP code lookup uses the public Zippopotam service, so no extra keys are required.

Back-end calls strictly follow the endpoints documented in https://documenter.getpostman.com/view/664302/S1ENwy59:

- Nearby hotspots: `GET /ref/hotspot/geo?lat={lat}&lng={lng}&dist={km}&back={days}`
- Hotspot activity: `GET /data/obs/{locId}/recent?back={days}&maxResults={n}`
- Nearby notable observations: `GET /data/obs/geo/recent/notable?lat={lat}&lng={lng}&dist={km}&back={days}&hotspot=true`

## Tech stack

- **Backend:** Express 5, node-fetch, lightweight validation helpers
- **Frontend:** React + Vite + TypeScript
- **Styling:** CSS modules (global) with utility-style classes

## Next steps & ideas

1. Persist recently fetched hotspots and add caching to reduce API calls.
2. Allow filtering by species or time of day.
3. Plot the results on an interactive map (Mapbox, Leaflet, or Google Maps).
