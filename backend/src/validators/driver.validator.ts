import { z } from 'zod';

export const createDriverSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  vehicleType: z.string().default('SEDAN'),
  model: z.string().min(1, 'Vehicle model is required'),
  numberPlate: z.string().min(1, 'Number plate is required'),
});

export const updateStatusSchema = z.object({
  status: z.enum(['OFFLINE', 'ONLINE']),
});

export const updateLocationSchema = z.object({
  latitude: z.number().min(-90).max(90, 'Latitude must be between -90 and 90'),
  longitude: z.number().min(-180).max(180, 'Longitude must be between -180 and 180'),
  heading: z.number().finite().min(0).max(360).optional().default(0),
  speed: z.number().finite().min(0).max(300).optional().default(0),
  accuracy: z.number().finite().min(0).optional(),
  timestamp: z.number().finite().positive().optional(),
});

export const nearbyDriversSchema = z.object({
  latitude: z.string().transform((v) => parseFloat(v)).pipe(z.number().min(-90).max(90)),
  longitude: z.string().transform((v) => parseFloat(v)).pipe(z.number().min(-180).max(180)),
  radiusKm: z.coerce.number().finite().min(0.1).max(50).default(5),
});

export type CreateDriverInput = z.infer<typeof createDriverSchema>;
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
