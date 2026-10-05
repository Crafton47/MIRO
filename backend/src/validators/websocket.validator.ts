import { z } from 'zod';

export const wsLocationEventSchema = z.object({
  driverId: z.string().uuid('Invalid driverId UUID'),
  latitude: z.number().min(-90).max(90, 'Latitude out of bounds'),
  longitude: z.number().min(-180).max(180, 'Longitude out of bounds'),
  heading: z.number().optional().default(0),
  speed: z.number().optional().default(0),
  timestamp: z.number().optional().default(() => Date.now()),
});

export const wsStatusEventSchema = z.object({
  driverId: z.string().uuid('Invalid driverId UUID'),
});

export const wsRideActionSchema = z.object({
  rideId: z.string().uuid('Invalid rideId UUID'),
  driverId: z.string().uuid('Invalid driverId UUID').optional(),
});
