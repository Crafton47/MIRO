import { Role, DriverStatus } from '@prisma/client';

export interface DriverLocationPayload {
  driverId: string;
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
  timestamp?: number;
}

export interface DriverLocationData {
  driverId: string;
  latitude: number;
  longitude: number;
  h3Index: string;
  heading: number;
  speed: number;
  status: DriverStatus;
  updatedAt: number;
}

export interface CandidateDriver {
  driverId: string;
  userId: string;
  driverName?: string;
  rating: number;
  latitude: number;
  longitude: number;
  distanceKm: number;
  etaMinutes: number;
  h3Index: string;
  vehicle?: {
    model: string;
    numberPlate: string;
    vehicleType: string;
  };
}

export interface FareEstimateResult {
  pickupLat: number;
  pickupLng: number;
  destLat: number;
  destLng: number;
  distanceKm: number;
  durationMin: number;
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  estimatedFare: number;
  currency: string;
}

export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: Role;
}
