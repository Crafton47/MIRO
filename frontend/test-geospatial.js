/**
 * Geospatial, Routing, and Autocomplete Integration Verification
 */

import { routingService } from './src/services/routingService.js';
import { geocodingService } from './src/services/geocodingService.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('🧪 Starting Geospatial & Routing Verification Tests...\n');

  // Test 1: Haversine distance
  console.log('1. Haversine Distance:');
  const sfPoint1 = { lat: 37.7749, lng: -122.4194 };
  const sfPoint2 = { lat: 37.7833, lng: -122.4167 };
  const dist = routingService.haversineDistance(sfPoint1, sfPoint2);
  assert(dist > 900 && dist < 1100, `Distance between SF points is ~960m (actual: ${Math.round(dist)}m)`);

  // Test 2: Bearing calculation
  console.log('\n2. Bearing Calculation:');
  const pNorth1 = { lat: 37.0, lng: -122.0 };
  const pNorth2 = { lat: 38.0, lng: -122.0 };
  const bearingNorth = routingService.calculateBearing(pNorth1, pNorth2);
  assert(bearingNorth === 0 || bearingNorth === 360, `Due North bearing is 0° (actual: ${bearingNorth}°)`);

  const pEast1 = { lat: 37.0, lng: -122.0 };
  const pEast2 = { lat: 37.0, lng: -121.0 };
  const bearingEast = routingService.calculateBearing(pEast1, pEast2);
  assert(bearingEast === 90, `Due East bearing is 90° (actual: ${bearingEast}°)`);

  // Test 3: Path metrics and continuous interpolation
  console.log('\n3. Continuous Road Interpolation:');
  const path = [
    { lat: 37.7749, lng: -122.4194 },
    { lat: 37.7780, lng: -122.4180 },
    { lat: 37.7833, lng: -122.4167 },
  ];
  const metrics = routingService.buildPathMetrics(path);
  assert(metrics.totalDistance > 0, `Total distance is positive (${Math.round(metrics.totalDistance)}m)`);
  assert(metrics.cumulative.length === 3, 'Cumulative array has 3 segment markers');

  const startPos = routingService.interpolatePositionAtDistance(path, metrics.cumulative, 0);
  assert(Math.abs(startPos.lat - path[0].lat) < 0.0001, '0m distance returns path origin');

  const midDist = metrics.totalDistance / 2;
  const midPos = routingService.interpolatePositionAtDistance(path, metrics.cumulative, midDist);
  assert(midPos.lat > path[0].lat && midPos.lat < path[2].lat, '50% distance returns intermediate latitude');
  assert(!midPos.isFinished, 'Midpoint is not marked finished');

  const endPos = routingService.interpolatePositionAtDistance(path, metrics.cumulative, metrics.totalDistance + 50);
  assert(endPos.isFinished, 'Distance exceeding total distance marks isFinished: true');
  assert(Math.abs(endPos.lat - path[2].lat) < 0.0001, 'End position snaps to target endpoint');

  // Test 4: Photon Feature Formatter
  console.log('\n4. Feature Formatter:');
  const mockFeature = {
    geometry: { coordinates: [-122.4075, 37.7879] },
    properties: {
      name: 'Union Square',
      street: '333 Post Street',
      city: 'San Francisco',
      state: 'CA',
      country: 'United States',
    },
  };
  const formatted = geocodingService.formatFeature(mockFeature);
  assert(formatted.title === 'Union Square', 'Correct primary title extracted');
  assert(formatted.lat === 37.7879 && formatted.lng === -122.4075, 'Precise lat/lng coordinates preserved');
  assert(formatted.fullAddress.includes('Union Square') && formatted.fullAddress.includes('San Francisco'), 'Contextual address formatted cleanly');

  // Test 5: Live OSRM Road Route Fetch (Kolkata: Esplanade -> Victoria Memorial)
  console.log('\n5. Live OSRM Driving Route API (Kolkata Route):');
  try {
    const route = await routingService.getDrivingRoute(
      { lat: 22.5646, lng: 88.3510 },
      { lat: 22.5448, lng: 88.3426 }
    );
    assert(route.coordinates.length > 5, `OSRM returned ${route.coordinates.length} road-following waypoints`);
    assert(route.distanceKm > 1.0 && route.distanceKm < 5.0, `OSRM road distance is realistic (${route.distanceKm} km)`);
    assert(route.durationMin >= 1, `OSRM road duration is realistic (${route.durationMin} min)`);
  } catch (err) {
    assert(false, `OSRM route fetch failed: ${err.message}`);
  }

  // Test 6: Live Photon Autocomplete API (Kolkata)
  console.log('\n6. Live Photon Autocomplete API (Kolkata):');
  try {
    const results = await geocodingService.searchAutocomplete('Park Street Kolkata', null, 3);
    assert(results.length > 0, `Photon returned ${results.length} address suggestions`);
    assert(results[0].title.length > 0, `Suggestion has title: "${results[0].title}"`);
    assert(typeof results[0].lat === 'number' && typeof results[0].lng === 'number', 'Suggestion has valid numerical lat/lng');
  } catch (err) {
    assert(false, `Photon autocomplete failed: ${err.message}`);
  }

  // Test 7: Live Reverse Geocoding (Kolkata)
  console.log('\n7. Live Reverse Geocoding API (Kolkata):');
  try {
    const rev = await geocodingService.reverseGeocode(22.5646, 88.3510);
    assert(rev && rev.address.length > 0, `Reverse geocode resolved address: "${rev.address}"`);
    assert(rev.lat === 22.5646 && rev.lng === 88.3510, 'Reverse geocode preserved exact input coordinates');
  } catch (err) {
    assert(false, `Reverse geocode failed: ${err.message}`);
  }

  // Test 8: Turn-by-turn road navigation steps parsing
  console.log('\n8. Turn-by-Turn Road Steps Parsing:');
  try {
    const routeWithSteps = await routingService.getDrivingRoute(
      { lat: 22.5646, lng: 88.3510 },
      { lat: 22.5448, lng: 88.3426 }
    );
    assert(Array.isArray(routeWithSteps.steps), 'Route includes steps array');
    assert(routeWithSteps.steps.length >= 2, `Route contains ${routeWithSteps.steps.length} distinct maneuver steps`);
    const firstStep = routeWithSteps.steps[0];
    assert(firstStep.instruction && firstStep.instruction.length > 0, `First maneuver has instruction: "${firstStep.instruction}"`);
    assert(typeof firstStep.distanceMeters === 'number', 'Step has distance in meters');
  } catch (err) {
    assert(false, `Step parsing failed: ${err.message}`);
  }

  // Test 9: Off-Route Deviation Detection (> 80m threshold)
  console.log('\n9. Off-Route Detection (> 80m):');
  const routePoints = [
    { lat: 22.5646, lng: 88.3510 },
    { lat: 22.5546, lng: 88.3510 },
    { lat: 22.5448, lng: 88.3426 },
  ];
  // Point very close to route (< 20m)
  const onRoutePos = { lat: 22.56461, lng: 88.35101 };
  const onRouteCheck = routingService.findClosestPointOnRoute(onRoutePos, routePoints);
  assert(!onRouteCheck.isOffRoute, `Point near route (<80m) is NOT marked off-route (actual: ${onRouteCheck.distanceToRouteMeters}m)`);

  // Point far from route (> 200m)
  const offRoutePos = { lat: 22.5646, lng: 88.3580 };
  const offRouteCheck = routingService.findClosestPointOnRoute(offRoutePos, routePoints);
  assert(offRouteCheck.isOffRoute, `Point >80m from route IS marked off-route (actual: ${offRouteCheck.distanceToRouteMeters}m)`);
  assert(offRouteCheck.distanceToRouteMeters > 80, `Deviation distance > 80m verified (${offRouteCheck.distanceToRouteMeters}m)`);

  // Test 10: Dynamic GPS Progress Calculation
  console.log('\n10. Dynamic GPS Progress Calculation:');
  const progress1 = routingService.calculateRemainingProgress(routePoints[0], routePoints);
  assert(progress1.remainingKm > 0, `Starting position has positive remaining distance (${progress1.remainingKm} km)`);
  assert(progress1.remainingMin >= 1, `Starting position has positive remaining ETA (${progress1.remainingMin} min)`);

  const progress2 = routingService.calculateRemainingProgress(routePoints[2], routePoints);
  assert(progress2.remainingKm === 0, `Target endpoint has 0 km remaining (${progress2.remainingKm} km)`);

  console.log(`\n========================================`);
  console.log(`Results: ${passed} PASSED, ${failed} FAILED`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
