import { useEffect, useMemo, useRef, useState } from 'react';
import logo from './assets/transparent-logo.png';
import './App.css';

//test

type Coordinates = {
  lat: number;
  lng: number;
};

type HotspotActivity = {
  checklistCount: number;
  observationCount: number;
  lastObservationDate: string | null;
  score: number;
  notableSpecies?: NotableSpecies[];
  speciesList?: NotableSpecies[];
};

type Hotspot = {
  locId: string;
  name: string;
  latitude: number;
  longitude: number;
  countryCode: string;
  regionCode: string;
  distanceKm: number | null;
  url: string;
  activity: HotspotActivity;
};

type NotableSpecies = {
  speciesCode: string;
  commonName: string | null;
  scientificName: string | null;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api';
const DISTANCE_OPTIONS = [5, 10, 15, 20, 30].map((miles) => ({
  miles,
  valueKm: Math.round(miles * 1.60934 * 10) / 10,
}));

const KM_TO_MILES = 0.621371;

const formatDistanceMiles = (distanceKm: number | null) => {
  if (distanceKm === null) {
    return 'unknown';
  }
  const miles = Math.round(distanceKm * KM_TO_MILES * 10) / 10;
  return `${miles} miles`;
};

export function App() {
  const [mode, setMode] = useState<'random' | 'top' | 'notable'>('random');
  const [distanceKm, setDistanceKm] = useState(DISTANCE_OPTIONS[1].valueKm);
  const [postalCode, setPostalCode] = useState('');
  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [loading, setLoading] = useState(false);
  const [geolocating, setGeolocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [randomHotspot, setRandomHotspot] = useState<Hotspot | null>(null);
  const [rankedHotspots, setRankedHotspots] = useState<Hotspot[]>([]);
  const [hasFetched, setHasFetched] = useState(false);
  const [expandedSpeciesId, setExpandedSpeciesId] = useState<string | null>(null);
  const [showRandomSpecies, setShowRandomSpecies] = useState(false);

  const randomResultRef = useRef<HTMLElement | null>(null);
  const listResultsRef = useRef<HTMLElement | null>(null);

  const locationLabel = useMemo(() => {
    if (coords) {
      return `Using your GPS location (${coords.lat.toFixed(2)}, ${coords.lng.toFixed(2)})`;
    }
    if (postalCode.trim()) {
      return `Using ZIP code ${postalCode.trim()}`;
    }
    return 'Provide a ZIP code or share your location to get started.';
  }, [coords, postalCode]);

  const buildQuery = () => {
    const params = new URLSearchParams({
      distanceKm: distanceKm.toString(),
    });

    if (coords) {
      params.set('lat', coords.lat.toString());
      params.set('lng', coords.lng.toString());
    } else if (postalCode.trim()) {
      params.set('postalCode', postalCode.trim());
    }

    return params.toString();
  };

  const fetchHotspots = async () => {
    setError(null);
    setStatus(null);
    setRandomHotspot(null);
    setRankedHotspots([]);
    setHasFetched(false);
    setExpandedSpeciesId(null);
    setShowRandomSpecies(false);

    if (!coords && postalCode.trim().length !== 5) {
      setError('Enter a valid 5-digit ZIP code or allow location access.');
      return;
    }

    setLoading(true);
    try {
      const endpoint =
        mode === 'random' ? 'hotspots/random' : mode === 'top' ? 'hotspots/top' : 'hotspots/notable';
      const response = await fetch(`${API_BASE_URL}/${endpoint}?${buildQuery()}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message ?? 'Unable to fetch hotspots.');
      }

      if (mode === 'random') {
        setRandomHotspot(payload.hotspot);
      } else {
        setRankedHotspots(payload.hotspots ?? []);
      }
      setHasFetched(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected error.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    await fetchHotspots();
  };

  const toggleSpeciesList = (locId: string) => {
    setExpandedSpeciesId((prev) => (prev === locId ? null : locId));
  };

  const toggleRandomSpecies = () => {
    setShowRandomSpecies((prev) => !prev);
  };

  const getScoreDescription = (context: 'random' | 'top' | 'notable') =>
    context === 'notable'
      ? 'Score = (checklists × 2) + unique notable species observed over the last 7 days.'
      : 'Score = (checklists × 2) + unique species observed over the last 7 days.';

  const requestCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported in this browser.');
      return;
    }

    setGeolocating(true);
    setStatus('Requesting your location...');
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({
          lat: Number(position.coords.latitude.toFixed(4)),
          lng: Number(position.coords.longitude.toFixed(4)),
        });
        setPostalCode('');
        setGeolocating(false);
        setStatus('Location locked in. Ready when you are!');
      },
      (geoError) => {
        setGeolocating(false);
        setStatus(null);
        setError(geoError.message ?? 'Unable to access your location.');
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
      },
    );
  };

  useEffect(() => {
    setRandomHotspot(null);
    setRankedHotspots([]);
    setStatus(null);
    setError(null);
    setHasFetched(false);
    setExpandedSpeciesId(null);
    setShowRandomSpecies(false);
  }, [mode]);

  useEffect(() => {
    if (!loading && mode === 'random' && randomHotspot && randomResultRef.current) {
      randomResultRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      randomResultRef.current.focus({ preventScroll: true });
    }
  }, [loading, mode, randomHotspot]);

  useEffect(() => {
    if (!loading && mode !== 'random' && rankedHotspots.length > 0 && listResultsRef.current) {
      listResultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      listResultsRef.current.focus({ preventScroll: true });
    }
  }, [loading, mode, rankedHotspots]);

  return (
    <div className="app">
      <section className="card hero">
        <img src={logo} alt="Birdbrain logo" className="hero-logo" />
        <div className="hero-copy">
          <h1>Discover Your Next Birding Adventure</h1>
          <p>
            Can’t decide where to go birding today? BirdBrain takes the guesswork out of it. Instantly find the most
            active nearby hotspots—or let the app surprise you with a random pick.
          </p>
        </div>
      </section>

      <section className="card">
        <header className="options">
          <button className={mode === 'random' ? 'active' : ''} onClick={() => setMode('random')}>
            Surprise me
          </button>
          <button className={mode === 'top' ? 'active' : ''} onClick={() => setMode('top')}>
            Top 5 active spots
          </button>
          <button className={mode === 'notable' ? 'active' : ''} onClick={() => setMode('notable')}>
            Top 5 notable spots
          </button>
        </header>

        <div className="form-grid">
          <div className="form-control">
            <label htmlFor="distance">Search radius</label>
            <select
              id="distance"
              value={distanceKm}
              onChange={(event) => setDistanceKm(Number(event.target.value))}
            >
              {DISTANCE_OPTIONS.map((option) => (
                <option key={option.miles} value={option.valueKm}>
                  {option.miles} miles ({option.valueKm} km)
                </option>
              ))}
            </select>
          </div>
          <div className="form-control">
            <label htmlFor="zip">ZIP code (optional)</label>
            <input
              id="zip"
              inputMode="numeric"
              maxLength={5}
              placeholder="e.g. 80302"
              value={postalCode}
              onChange={(event) => {
                const value = event.target.value.replace(/\D/g, '');
                setPostalCode(value);
                if (value) {
                  setCoords(null);
                }
              }}
            />
          </div>
        </div>

        <div className="form-actions">
          <button type="button" className="secondary" onClick={requestCurrentLocation} disabled={geolocating}>
            {geolocating ? 'Locating...' : 'Use my current location'}
          </button>
          <button className="primary" type="button" onClick={handleSubmit} disabled={loading}>
            {loading
              ? 'Searching...'
              : mode === 'random'
                ? 'Find a random hotspot'
                : mode === 'top'
                  ? 'Show top hotspots'
                  : 'Show notable hotspots'}
          </button>
          <span className="muted">{locationLabel}</span>
        </div>

        {status && <div className="muted">{status}</div>}
        {error && <div className="error">{error}</div>}
      </section>

      {!loading && mode === 'random' && randomHotspot && (
        <section className="card" ref={randomResultRef} tabIndex={-1}>
          <h2>Today's pick</h2>
          <div className="result-card">
            <h3>{randomHotspot.name}</h3>
            <p className="muted">
              {randomHotspot.regionCode}, {randomHotspot.countryCode}
            </p>
            <a href={randomHotspot.url} target="_blank" rel="noreferrer">
              View on eBird (opens new tab)
            </a>
            <p className="muted">Distance: {formatDistanceMiles(randomHotspot.distanceKm)}</p>
            <p className="muted">
              Coordinates: {randomHotspot.latitude.toFixed(3)}, {randomHotspot.longitude.toFixed(3)}
            </p>
            <div className="stats">
              <div className="stat-pill">
                Checklists (7d)
                <strong>{randomHotspot.activity.checklistCount}</strong>
              </div>
              <div className="stat-pill">
                Species (7d)
                {randomHotspot.activity.speciesList && randomHotspot.activity.speciesList.length > 0 ? (
                  <button
                    type="button"
                    className="stat-link-button"
                    onClick={toggleRandomSpecies}
                    aria-expanded={showRandomSpecies}
                  >
                    {randomHotspot.activity.observationCount}
                  </button>
                ) : (
                  <strong>{randomHotspot.activity.observationCount}</strong>
                )}
              </div>
              <div className="stat-pill">
                Activity score
                <button
                  type="button"
                  className="stat-tooltip-button"
                  data-tooltip={getScoreDescription('random')}
                  aria-label={getScoreDescription('random')}
                >
                  {randomHotspot.activity.score}
                </button>
              </div>
            </div>
            {showRandomSpecies && randomHotspot.activity.speciesList && (
              <div className="notable-panel">
                <p className="muted">Unique species observed in the past 7 days:</p>
                <ul>
                  {randomHotspot.activity.speciesList.map((species, index) => (
                    <li
                      key={
                        species.speciesCode ?? species.commonName ?? species.scientificName ?? `${randomHotspot.locId}-${index}`
                      }
                    >
                      <strong>{species.commonName ?? species.scientificName ?? 'Unknown species'}</strong>
                      {species.scientificName && species.scientificName !== species.commonName ? (
                        <span className="muted"> ({species.scientificName})</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {!loading && mode !== 'random' && (
        <section className="card" ref={listResultsRef} tabIndex={-1}>
          <h2>{mode === 'top' ? 'Top 5 active hotspots' : 'Top 5 notable hotspots'}</h2>
          <p className="muted">
            {mode === 'top'
              ? 'Ranked by checklists and observations submitted in the last 7 days (score = checklists x 2 + observations).'
              : 'Ranked by the number of notable (rare or unusual) checklists submitted in the last 7 days.'}
          </p>
          {!hasFetched ? (
            <p className="muted">Run the search to see what looks interesting this week.</p>
          ) : rankedHotspots.length === 0 ? (
            <p className="muted">
              {mode === 'top'
                ? 'No hotspots met the 7-day activity threshold within this radius.'
                : 'No notable sightings have been reported within this radius in the past 7 days.'}
            </p>
          ) : (
            <div className="results-grid">
              {rankedHotspots.map((spot) => {
                const speciesList =
                  mode === 'notable' ? spot.activity.notableSpecies : spot.activity.speciesList;
                const speciesLabel = mode === 'top' ? 'Species' : 'Notable species';
                const speciesHeading =
                  mode === 'top'
                    ? 'Unique species observed in the past 7 days:'
                    : 'Species flagged as notable in the past 7 days:';
                const hasSpeciesList = speciesList && speciesList.length > 0;
                return (
                  <article key={spot.locId} className="result-card">
                    <h3>{spot.name}</h3>
                    <p className="muted">
                      {spot.regionCode}, {spot.countryCode}
                    </p>
                    <p className="muted">Distance: {formatDistanceMiles(spot.distanceKm)}</p>
                    <a href={spot.url} target="_blank" rel="noreferrer">
                      Explore on eBird (opens new tab)
                    </a>
                    <div className="stats">
                      <div className="stat-pill">
                        Checklists
                        <strong>{spot.activity.checklistCount}</strong>
                      </div>
                      <div className="stat-pill">
                        {speciesLabel}
                        {hasSpeciesList ? (
                          <button
                            type="button"
                            className="stat-link-button"
                            onClick={() => toggleSpeciesList(spot.locId)}
                            aria-expanded={expandedSpeciesId === spot.locId}
                          >
                            {spot.activity.observationCount}
                          </button>
                        ) : (
                          <strong>{spot.activity.observationCount}</strong>
                        )}
                      </div>
                      <div className="stat-pill">
                        Score
                        <button
                          type="button"
                          className="stat-tooltip-button"
                          data-tooltip={getScoreDescription(mode)}
                          aria-label={getScoreDescription(mode)}
                        >
                          {spot.activity.score}
                        </button>
                      </div>
                    </div>
                    {hasSpeciesList && expandedSpeciesId === spot.locId && (
                      <div className="notable-panel">
                        <p className="muted">{speciesHeading}</p>
                        <ul>
                        {speciesList.map((species: NotableSpecies, index: number) => (
                            <li
                              key={
                                species.speciesCode ??
                                species.commonName ??
                                species.scientificName ??
                                `${spot.locId}-${index}`
                              }
                            >
                              <strong>{species.commonName ?? species.scientificName ?? 'Unknown species'}</strong>
                              {species.scientificName && species.scientificName !== species.commonName ? (
                                <span className="muted"> ({species.scientificName})</span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default App;
