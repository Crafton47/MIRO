import { z } from 'zod';

export const estimateFareSchema = z.object({
  pickupLat: z.number().min(-90).max(90),
  pickupLng: z.number().min(-180).max(180),
  destLat: z.number().min(-90).max(90),
  destLng: z.number().min(-180).max(180),
});

export const createRideSchema = z.object({
  riderId: z.string().uuid(),
  pickupLat: z.number().min(-90).max(90),
  pickupLng: z.number().min(-180).max(180),
  destLat: z.number().min(-90).max(90),
  destLng: z.number().min(-180).max(180),
  pickupAddress: z.string().min(1, 'Pickup address is required'),
  destAddress: z.string().min(1, 'Destination address is required'),
});

export const acceptRideSchema = z.object({
  driverId: z.string().uuid(),
});

export const cancelRideSchema = z.object({
  reason: z.string().optional(),
});

export type EstimateFareInput = z.infer<typeof estimateFareSchema>;
export type CreateRideInput = z.infer<typeof createRideSchema>;
export type AcceptRideInput = z.infer<typeof acceptRideSchema>;
export type CancelRideInput = z.infer<typeof cancelRideSchema>;
