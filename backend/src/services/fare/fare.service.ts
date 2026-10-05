import { calculateHaversineDistance, estimateTravelTimeMinutes } from '../../utils/geo.js';
import { FareEstimateResult } from '../../types/index.js';

export class FareService {
  private readonly BASE_FARE = 3.5;
  private readonly RATE_PER_KM = 1.2;
  private readonly RATE_PER_MIN = 0.25;
  private readonly MIN_FARE = 5.0;

  /**
   * Calculate estimated or final fare for a route
   */
  public calculateFare(
    pickupLat: number,
    pickupLng: number,
    destLat: number,
    destLng: number
  ): FareEstimateResult {
    const distanceKm = calculateHaversineDistance(pickupLat, pickupLng, destLat, destLng);
    const durationMin = estimateTravelTimeMinutes(distanceKm);

    const distanceFare = Math.round(distanceKm * this.RATE_PER_KM * 100) / 100;
    const timeFare = Math.round(durationMin * this.RATE_PER_MIN * 100) / 100;

    const rawTotal = this.BASE_FARE + distanceFare + timeFare;
    const estimatedFare = Math.round(Math.max(this.MIN_FARE, rawTotal) * 100) / 100;

    return {
      pickupLat,
      pickupLng,
      destLat,
      destLng,
      distanceKm,
      durationMin,
      baseFare: this.BASE_FARE,
      distanceFare,
      timeFare,
      estimatedFare,
      currency: 'USD',
    };
  }
}

export const fareService = new FareService();
