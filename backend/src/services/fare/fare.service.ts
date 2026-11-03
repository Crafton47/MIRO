import { calculateHaversineDistance, estimateTravelTimeMinutes } from '../../utils/geo.js';
import { FareEstimateResult } from '../../types/index.js';

export class FareService {
  private readonly BASE_FARE = 50.0; // ₹50 base flag-down fare
  private readonly RATE_PER_KM = 16.0; // ₹16 per kilometre
  private readonly RATE_PER_MIN = 2.0; // ₹2 per minute
  private readonly MIN_FARE = 60.0; // ₹60 minimum trip fare

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
      currency: 'INR',
    };
  }
}

export const fareService = new FareService();
