import { Router } from 'express';
import { rideController } from '../controllers/ride.controller.js';

const router = Router();

router.post('/estimate', rideController.estimateFare);
router.post('/', rideController.createRide);
router.get('/:id', rideController.getRideById);
router.post('/:id/accept', rideController.acceptRide);
router.post('/:id/start', rideController.startRide);
router.post('/:id/complete', rideController.completeRide);
router.post('/:id/cancel', rideController.cancelRide);

export default router;
