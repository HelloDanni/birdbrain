import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const EBIRD_API_KEY = process.env.EBIRD_API_KEY;
const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN;

if (!EBIRD_API_KEY) {
  throw new Error('Missing EBIRD_API_KEY. Set it in .env before starting the server.');
}

const EBIRD_BASE_URL = 'https://api.ebird.org/v2';
const ZIP_LOOKUP_URL = 'https://api.zippopotam.us/us';
const RECENT_WINDOW_DAYS = 7;
const MAX_EVALUATED_HOTSPOTS = 50;
const HOTSPOT_ACTIVITY_MAX_RESULTS = 500;
const HOTSPOT_ACTIVITY_CONCURRENCY = 5;
const NEARBY_OBS_MAX_RADIUS_KM = 50;
const NOTABLE_MAX_RESULTS = 500;
const TOP_COUNT = 5;

const app = express();
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || !CLIENT_ORIGIN) {
        callback(null, true);
        return;
      }

      const allowed = CLIENT_ORIGIN.split(',').map((entry) => entry.trim());
      if (allowed.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Origin not allowed by CORS'), false);
      }
    },
  }),
);
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/hotspots/random', async (req, res) => {
  try {
    const { distanceKm = '25', lat, lng, postalCode } = req.query;
    const distance = normalizeDistance(distanceKm);
    const origin = await resolveOrigin({ lat, lng, postalCode });

    const hotspots = await getHotspotsByGeo({ ...origin, distanceKm: distance });
    if (!hotspots.length) {
      res.status(404).json({ message: 'No hotspots found for the provided criteria.' });
      return;
    }

    const randomHotspot = hotspots[Math.floor(Math.random() * hotspots.length)];
    const activity = await getHotspotActivity(randomHotspot.locId, {
      includeSpeciesList: true,
      countSpecies: true,
    });

    res.json({
      mode: 'random',
      distanceKm: distance,
      origin,
      hotspot: {
        ...normalizeHotspot(randomHotspot, origin),
        activity,
      },
    });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/hotspots/top', async (req, res) => {
  try {
    const { distanceKm = '25', lat, lng, postalCode } = req.query;
    const distance = normalizeDistance(distanceKm);
    const origin = await resolveOrigin({ lat, lng, postalCode });

    const hotspots = await getHotspotsByGeo({
      ...origin,
      distanceKm: distance,
      limit: MAX_EVALUATED_HOTSPOTS,
    });

    if (!hotspots.length) {
      res.status(404).json({ message: 'No hotspots found for the provided criteria.' });
      return;
    }

    const scored = await mapWithConcurrency(
      hotspots,
      HOTSPOT_ACTIVITY_CONCURRENCY,
      async (hotspot) => ({
        ...normalizeHotspot(hotspot, origin),
        activity: await getHotspotActivity(hotspot.locId, {
          includeSpeciesList: true,
          countSpecies: true,
        }),
      }),
    );

    const ranked = scored.sort((a, b) => b.activity.score - a.activity.score).slice(0, TOP_COUNT);

    res.json({
      mode: 'top',
      distanceKm: distance,
      origin,
      hotspots: ranked,
    });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/hotspots/notable', async (req, res) => {
  try {
    const { distanceKm = '25', lat, lng, postalCode } = req.query;
    const distance = normalizeDistance(distanceKm);
    const origin = await resolveOrigin({ lat, lng, postalCode });

    const hotspots = await getHotspotsByGeo({
      ...origin,
      distanceKm: distance,
      limit: MAX_EVALUATED_HOTSPOTS,
    });

    if (!hotspots.length) {
      res.status(404).json({ message: 'No hotspots found for the provided criteria.' });
      return;
    }

    const hotspotMap = new Map(hotspots.map((hotspot) => [hotspot.locId, hotspot]));
    const notableHotspots = await getNotableHotspotsWithinRadius(
      { ...origin, distanceKm: distance },
      hotspotMap,
      origin,
    );

    const ranked = notableHotspots
      .sort((a, b) => {
        if (b.activity.observationCount !== a.activity.observationCount) {
          return b.activity.observationCount - a.activity.observationCount;
        }
        return b.activity.checklistCount - a.activity.checklistCount;
      })
      .slice(0, TOP_COUNT);

    res.json({
      mode: 'notable',
      distanceKm: distance,
      origin,
      hotspots: ranked,
    });
  } catch (error) {
    handleError(res, error);
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistDir = path.resolve(__dirname, '../client/dist');

if (fs.existsSync(clientDistDir)) {
  app.use(express.static(clientDistDir));
  // Serve the SPA for any non-API route.
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(clientDistDir, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Birdbrain API listening on port ${PORT}`);
});

async function resolveOrigin({ lat, lng, postalCode }) {
  if (lat !== undefined && lng !== undefined) {
    return {
      lat: toNumber(lat, 'lat'),
      lng: toNumber(lng, 'lng'),
      source: 'coordinates',
    };
  }

  if (postalCode) {
    const location = await lookupPostalCode(postalCode);
    return {
      ...location,
      postalCode,
      source: 'postalCode',
    };
  }

  throw createHttpError(400, 'Provide either lat/lng coordinates or a postalCode.');
}

async function lookupPostalCode(postalCode) {
  const response = await fetch(`${ZIP_LOOKUP_URL}/${encodeURIComponent(postalCode)}`);
  if (!response.ok) {
    throw createHttpError(404, `Could not resolve postal code ${postalCode}`);
  }

  const data = await response.json();
  const place = data.places?.[0];
  if (!place) {
    throw createHttpError(404, `No coordinates returned for postal code ${postalCode}`);
  }

  return {
    lat: Number(place.latitude),
    lng: Number(place.longitude),
  };
}

async function getHotspotsByGeo({ lat, lng, distanceKm, limit }) {
  const searchParams = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    dist: String(distanceKm),
    back: String(RECENT_WINDOW_DAYS),
    fmt: 'json',
    maxResults: String(limit ?? MAX_EVALUATED_HOTSPOTS),
  });

  const url = `${EBIRD_BASE_URL}/ref/hotspot/geo?${searchParams.toString()}`;
  const response = await fetchWithKey(url);
  const hotspots = await response.json();
  return Array.isArray(hotspots) ? hotspots : [];
}

async function getHotspotActivity(locId, options = {}) {
  const searchParams = new URLSearchParams({
    back: String(RECENT_WINDOW_DAYS),
    maxResults: String(HOTSPOT_ACTIVITY_MAX_RESULTS),
  });

  const url = `${EBIRD_BASE_URL}/data/obs/${locId}/recent?${searchParams.toString()}`;

  try {
    const response = await fetchWithKey(url);
    const observations = (await response.json()) ?? [];
    return summarizeObservationStats(observations, options);
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 410) {
      return summarizeObservationStats([], options);
    }
    throw error;
  }
}

async function getNotableHotspotsWithinRadius(location, hotspotMap, origin) {
  const searchParams = new URLSearchParams({
    lat: String(location.lat),
    lng: String(location.lng),
    dist: String(Math.min(location.distanceKm, NEARBY_OBS_MAX_RADIUS_KM)),
    back: String(RECENT_WINDOW_DAYS),
    hotspot: 'true',
    maxResults: String(NOTABLE_MAX_RESULTS),
  });

  const url = `${EBIRD_BASE_URL}/data/obs/geo/recent/notable?${searchParams.toString()}`;
  const response = await fetchWithKey(url);
  const observations = (await response.json()) ?? [];

  const grouped = groupObservationsByLocation(observations, {
    includeSpeciesList: true,
    countSpecies: true,
    includeNotableSpecies: true,
  });
  const results = [];

  grouped.forEach((accumulator, locId) => {
    const hotspot = hotspotMap.get(locId);
    if (!hotspot) {
      return;
    }
    results.push({
      ...normalizeHotspot(hotspot, origin),
      activity: finalizeActivityAccumulator(accumulator),
    });
  });

  return results;
}

async function fetchWithKey(url) {
  const response = await fetch(url, {
    headers: {
      'X-eBirdApiToken': EBIRD_API_KEY,
      'User-Agent': 'Birdbrain/1.0',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw createHttpError(response.status, `eBird request failed (${response.status}): ${message}`);
  }

  return response;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function normalizeDistance(value) {
  const numeric = toNumber(value, 'distanceKm');
  return Math.min(Math.max(numeric, 1), 500);
}

function summarizeObservationStats(
  observations,
  { includeSpeciesList = false, countSpecies = false, includeNotableSpecies = false } = {},
) {
  const accumulator = createActivityAccumulator({
    includeSpeciesList,
    countSpecies,
    includeNotableSpecies,
  });
  (observations ?? []).forEach((obs) => applyObservationToAccumulator(accumulator, obs));
  return finalizeActivityAccumulator(accumulator);
}

function groupObservationsByLocation(
  observations,
  { includeSpeciesList = false, countSpecies = false, includeNotableSpecies = false } = {},
) {
  const map = new Map();
  (observations ?? []).forEach((obs) => {
    if (!obs.locId) {
      return;
    }
    if (!map.has(obs.locId)) {
      map.set(
        obs.locId,
        createActivityAccumulator({ includeSpeciesList, countSpecies, includeNotableSpecies }),
      );
    }
    applyObservationToAccumulator(map.get(obs.locId), obs);
  });
  return map;
}

function createActivityAccumulator({
  includeSpeciesList = false,
  countSpecies = false,
  includeNotableSpecies = false,
} = {}) {
  return {
    checklistIds: new Set(),
    observationCount: 0,
    lastObservationTimestamp: null,
    includeSpeciesList,
    countSpecies,
    includeNotableSpecies,
    speciesMap: includeSpeciesList || countSpecies ? new Map() : null,
  };
}

function applyObservationToAccumulator(accumulator, observation) {
  if (!observation) {
    return;
  }

  if (observation.subId) {
    accumulator.checklistIds.add(observation.subId);
  }

  const increment = typeof observation.howMany === 'number' ? observation.howMany : 1;
  accumulator.observationCount += increment;

  if (observation.obsDt) {
    const timestamp = Date.parse(observation.obsDt);
    if (!Number.isNaN(timestamp)) {
      if (!accumulator.lastObservationTimestamp || timestamp > accumulator.lastObservationTimestamp) {
        accumulator.lastObservationTimestamp = timestamp;
      }
    }
  }

  if ((accumulator.includeSpeciesList || accumulator.countSpecies) && accumulator.speciesMap && observation.speciesCode) {
    if (!accumulator.speciesMap.has(observation.speciesCode)) {
      accumulator.speciesMap.set(observation.speciesCode, {
        speciesCode: observation.speciesCode,
        commonName: observation.comName ?? null,
        scientificName: observation.sciName ?? null,
      });
    }
  }
}

function finalizeActivityAccumulator(accumulator) {
  const checklistCount = accumulator.checklistIds.size;
  const observationCount = accumulator.speciesMap ? accumulator.speciesMap.size : accumulator.observationCount;
  const result = {
    checklistCount,
    observationCount,
    lastObservationDate: accumulator.lastObservationTimestamp
      ? new Date(accumulator.lastObservationTimestamp).toISOString()
      : null,
    score: checklistCount * 2 + observationCount,
  };

  if (accumulator.speciesMap && accumulator.speciesMap.size > 0) {
    const speciesList = Array.from(accumulator.speciesMap.values()).sort((a, b) => {
      const nameA = a.commonName ?? a.scientificName ?? '';
      const nameB = b.commonName ?? b.scientificName ?? '';
      return nameA.localeCompare(nameB);
    });
    result.speciesList = speciesList;
    if (accumulator.includeNotableSpecies) {
      result.notableSpecies = speciesList;
    }
  }

  return result;
}

function toNumber(value, label) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    throw createHttpError(400, `Invalid ${label} value`);
  }
  return numeric;
}

function normalizeHotspot(hotspot, relativeTo) {
  const distanceKm =
    relativeTo && relativeTo.lat && relativeTo.lng
      ? calculateDistanceKm(relativeTo.lat, relativeTo.lng, hotspot.lat, hotspot.lng)
      : hotspot.distanceKm ?? hotspot.distance ?? null;

  return {
    locId: hotspot.locId,
    name: hotspot.locName,
    latitude: hotspot.lat,
    longitude: hotspot.lng,
    countryCode: hotspot.countryCode,
    regionCode: hotspot.subnational1Code,
    distanceKm,
    url: `https://ebird.org/hotspot/${hotspot.locId}`,
  };
}

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

function handleError(res, error) {
  console.error(error);
  const statusCode = error.statusCode && Number.isInteger(error.statusCode) ? error.statusCode : 500;
  res.status(statusCode).json({
    message: error.message ?? 'Unexpected server error',
  });
}

function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}
