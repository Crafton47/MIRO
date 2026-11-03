export function getEnv(key, fallback) {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
      return import.meta.env[key];
    }
  } catch {}
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key];
  }
  return fallback;
}

export function getApiBaseUrl() {
  return import.meta.env?.VITE_API_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
}
export function getWsBaseUrl() {
  return import.meta.env?.VITE_WS_URL || getApiBaseUrl();
}

export const API_BASE_URL = getApiBaseUrl();
export const WS_BASE_URL = getWsBaseUrl();

export const CURRENCY_SYMBOL = '₹';
export const CURRENCY_CODE = 'INR';

export const DEMO_USERS = {
  rider: {
    id: '11111111-1111-4000-a000-000000000001',
    name: 'Rohan Sen',
    email: 'rider@miro.local',
    phone: '+919830001111',
    role: 'RIDER',
  },
  driver1: {
    id: '00000000-0000-4000-a000-000000000001',
    userId: '22222222-2222-4000-a000-000000000001',
    name: 'Debashis Mukherjee (D1)',
    email: 'driver1@miro.local',
    phone: '+919830002221',
    role: 'DRIVER',
    vehicle: {
      vehicleType: 'SEDAN',
      model: 'Maruti Suzuki Dzire',
      numberPlate: 'WB-02-GPS-1001',
    },
  },
};

export const DEFAULT_COORDS = {
  center: { lat: 22.5646, lng: 88.3510 },
  pickup: {
    lat: 22.5646,
    lng: 88.3510,
    address: 'Esplanade Metro Station, Dharmatala, Kolkata',
  },
  destination: {
    lat: 22.5448,
    lng: 88.3426,
    address: 'Victoria Memorial, Queens Way, Kolkata',
  },
};

export const POPULAR_LOCATIONS = [
  {
    name: 'Victoria Memorial',
    address: 'Queens Way, Maidan, Kolkata',
    lat: 22.5448,
    lng: 88.3426,
  },
  {
    name: 'Howrah Railway Station',
    address: 'Station Road, Howrah, Kolkata',
    lat: 22.5838,
    lng: 88.3426,
  },
  {
    name: 'Park Street',
    address: 'Park Street, Chowringhee, Kolkata',
    lat: 22.5516,
    lng: 88.3524,
  },
  {
    name: 'Dakshineswar Kali Temple',
    address: 'Mayadib, Dakshineswar, Kolkata',
    lat: 22.6531,
    lng: 88.3575,
  },
  {
    name: 'Salt Lake Sector V',
    address: 'Sector V, Bidhannagar, Kolkata',
    lat: 22.5804,
    lng: 88.4378,
  },
  {
    name: 'Netaji Subhash Chandra Bose Airport (CCU)',
    address: 'Dum Dum, Kolkata',
    lat: 22.6547,
    lng: 88.4467,
  },
];

export const VEHICLE_TIERS = [
  {
    id: 'miro_go',
    name: 'MIRO Go',
    description: 'Affordable, everyday Kolkata rides',
    seats: 4,
    multiplier: 1.0,
    etaOffset: 2,
    badge: 'Popular',
  },
  {
    id: 'miro_comfort',
    name: 'MIRO Comfort',
    description: 'Air-conditioned sedans with extra legroom',
    seats: 4,
    multiplier: 1.25,
    etaOffset: 3,
  },
  {
    id: 'miro_premier',
    name: 'MIRO Premier',
    description: 'Top-rated drivers & premium comfort',
    seats: 4,
    multiplier: 1.6,
    etaOffset: 5,
    badge: 'Premium',
  },
  {
    id: 'miro_xl',
    name: 'MIRO XL',
    description: 'Spacious 6-seater SUVs for family & luggage',
    seats: 6,
    multiplier: 1.8,
    etaOffset: 4,
  },
];

export const RIDE_STATUS = {
  REQUESTED: 'REQUESTED',
  SEARCHING: 'SEARCHING',
  DRIVER_ASSIGNED: 'DRIVER_ASSIGNED',
  DRIVER_ARRIVING: 'DRIVER_ARRIVING',
  DRIVER_ARRIVED: 'DRIVER_ARRIVED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

export const DRIVER_STATUS = {
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  IN_RIDE: 'IN_RIDE',
};
