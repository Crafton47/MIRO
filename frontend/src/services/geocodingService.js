import { getEnv } from '../utils/constants.js';
/**
 * Configurable Geocoding & Address Autocomplete Service
 * 
 * Uses Photon by Komoot (OpenStreetMap-based typeahead geocoder) for fast,
 * compliant interactive address autocomplete without requiring mandatory API keys.
 * Also supports configurable custom endpoints via environment variables.
 * 
 * Complies with OSM/Nominatim usage guidelines by avoiding client-side keystroke
 * hammering on public Nominatim endpoints.
 */

const DEFAULT_PHOTON_SEARCH_URL = 'https://photon.komoot.io/api/';
const DEFAULT_PHOTON_REVERSE_URL = 'https://photon.komoot.io/reverse';
const NOMINATIM_REVERSE_FALLBACK = 'https://nominatim.openstreetmap.org/reverse';

class GeocodingService {
  constructor() {
    this.searchBaseUrl = getEnv('VITE_GEOCODING_SEARCH_URL', DEFAULT_PHOTON_SEARCH_URL);
    this.reverseBaseUrl = getEnv('VITE_GEOCODING_REVERSE_URL', DEFAULT_PHOTON_REVERSE_URL);
    this.apiKey = getEnv('VITE_GEOCODING_API_KEY', '');

    this.cache = new Map();
    this.reverseCache = new Map();
    this.currentSearchAbortController = null;
    this.currentReverseRequestId = 0;
  }

  /**
   * Format Photon GeoJSON feature properties into clean title, subtitle, and address
   */
  formatFeature(feature) {
    const props = feature.properties || {};
    const coords = feature.geometry?.coordinates || [0, 0];
    const lng = coords[0];
    const lat = coords[1];

    const name = props.name || '';
    const street = props.street || '';
    const houseNumber = props.housenumber || '';
    const locality = props.locality || props.district || '';
    const city = props.city || props.town || props.village || '';
    const state = props.state || '';
    const country = props.country || '';
    const postcode = props.postcode || '';

    // Determine primary display title
    let title = name;
    if (!title && street) {
      title = houseNumber ? `${houseNumber} ${street}` : street;
    }
    if (!title && city) {
      title = city;
    }
    if (!title) {
      title = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }

    // Build context components that aren't identical to title
    const contextParts = [];
    if (houseNumber && street && title !== `${houseNumber} ${street}` && title !== street) {
      contextParts.push(`${houseNumber} ${street}`);
    } else if (street && title !== street) {
      contextParts.push(street);
    }
    if (locality && locality !== title) contextParts.push(locality);
    if (city && city !== title) contextParts.push(city);
    if (state && state !== title) contextParts.push(state);
    if (country && country !== title) contextParts.push(country);

    const subtitle = contextParts.join(', ') || 'Known location';
    const fullAddress = [title, subtitle].filter((p) => p && p !== 'Known location').join(', ');

    return {
      id: `${props.osm_type || 'osm'}_${props.osm_id || Math.random()}`,
      title,
      subtitle,
      fullAddress: fullAddress || title,
      lat: parseFloat(lat.toFixed(6)),
      lng: parseFloat(lng.toFixed(6)),
      osmType: props.osm_type,
      raw: props,
    };
  }

  /**
   * Interactive autocomplete query with debouncing and active request cancellation
   * @param {string} query - user typed text
   * @param {object} [biasCoords] - optional center lat/lng to bias results
   * @param {number} [limit=6]
   * @returns {Promise<Array>}
   */
  async searchAutocomplete(query, biasCoords = null, limit = 6) {
    const trimmed = (query || '').trim();
    if (trimmed.length < 2) {
      return [];
    }

    const cacheKey = `${trimmed.toLowerCase()}_${biasCoords ? `${biasCoords.lat.toFixed(2)},${biasCoords.lng.toFixed(2)}` : 'none'}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // Abort previous in-flight search
    if (this.currentSearchAbortController) {
      this.currentSearchAbortController.abort();
    }
    this.currentSearchAbortController = new AbortController();

    const params = new URLSearchParams({
      q: trimmed,
      limit: String(limit),
    });

    if (biasCoords && typeof biasCoords.lat === 'number' && typeof biasCoords.lng === 'number') {
      params.append('lat', String(biasCoords.lat));
      params.append('lon', String(biasCoords.lng));
    }

    if (this.apiKey) {
      params.append('key', this.apiKey);
    }

    const url = `${this.searchBaseUrl}?${params.toString()}`;

    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([this.currentSearchAbortController.signal, AbortSignal.timeout(10000)]),
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Autocomplete service HTTP ${response.status}`);
      }

      const data = await response.json();
      const features = Array.isArray(data.features) ? data.features : [];
      const results = features.map((f) => this.formatFeature(f));

      // Cache result (capped at 50 entries)
      if (this.cache.size > 50) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }
      this.cache.set(cacheKey, results);

      return results;
    } catch (err) {
      if (err.name === 'AbortError') {
        // Expected when user continues typing
        return [];
      }
      console.warn('Autocomplete fetch failed:', err.message);
      throw err;
    }
  }

  /**
   * Reverse geocode coordinates to the nearest street address or place name
   * Preserves exact clicked coordinates even if road is slightly offset.
   * @param {number} lat
   * @param {number} lng
   * @returns {Promise<{ address: string, lat: number, lng: number }>}
   */
  async reverseGeocode(lat, lng) {
    const exactLat = parseFloat(Number(lat).toFixed(6));
    const exactLng = parseFloat(Number(lng).toFixed(6));
    const cacheKey = `${exactLat.toFixed(4)},${exactLng.toFixed(4)}`;

    if (this.reverseCache.has(cacheKey)) {
      return {
        address: this.reverseCache.get(cacheKey),
        lat: exactLat,
        lng: exactLng,
      };
    }

    const requestId = ++this.currentReverseRequestId;

    // 1. Try Photon reverse
    try {
      const photonUrl = `${this.reverseBaseUrl}?lat=${exactLat}&lon=${exactLng}`;
      const res = await fetch(photonUrl, {
        signal: AbortSignal.timeout(6000),
        headers: { Accept: 'application/json' },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.features && data.features.length > 0) {
          if (requestId !== this.currentReverseRequestId) {
            return null; // Stale request superseded by newer click
          }
          const formatted = this.formatFeature(data.features[0]);
          const address = formatted.fullAddress;
          if (this.reverseCache.size >= 100) this.reverseCache.delete(this.reverseCache.keys().next().value);
          this.reverseCache.set(cacheKey, address);
          return { address, lat: exactLat, lng: exactLng };
        }
      }
    } catch (err) {
      console.warn('Photon reverse geocode error:', err.message);
    }

    // 2. Try single Nominatim reverse fallback
    try {
      const nomUrl = `${NOMINATIM_REVERSE_FALLBACK}?format=jsonv2&lat=${exactLat}&lon=${exactLng}`;
      const res = await fetch(nomUrl, {
        signal: AbortSignal.timeout(6000),
        headers: {
          Accept: 'application/json',
        },
      });

      if (res.ok) {
        const data = await res.json();
        if (requestId !== this.currentReverseRequestId) {
          return null;
        }
        if (data.display_name) {
          // Truncate overly verbose Nominatim string to first 3-4 segments
          const parts = data.display_name.split(', ');
          const address = parts.slice(0, 3).join(', ');
          if (this.reverseCache.size >= 100) this.reverseCache.delete(this.reverseCache.keys().next().value);
          this.reverseCache.set(cacheKey, address);
          return { address, lat: exactLat, lng: exactLng };
        }
      }
    } catch (err) {
      console.warn('Nominatim reverse geocode fallback error:', err.message);
    }

    // 3. Fallback to clean coordinate string
    const fallbackAddress = `${exactLat.toFixed(5)}, ${exactLng.toFixed(5)}`;
    return {
      address: fallbackAddress,
      lat: exactLat,
      lng: exactLng,
    };
  }
}

export const geocodingService = new GeocodingService();
