import { Router } from 'express';
import { rideController } from '../controllers/ride.controller.js';

import { authenticate } from '../middleware/auth.middleware.js';
import { rideOwner, riderIdentity } from '../middleware/ownership.middleware.js';
const router = Router();

router.post('/estimate', rideController.estimateFare);
router.use(authenticate);
router.get('/active', rideController.activeRide);
router.post('/', riderIdentity, rideController.createRide);
router.get('/:id', rideOwner(false), rideController.getRideById);
router.post('/:id/decline', rideOwner(true), rideController.declineRide);
router.post('/:id/accept', rideOwner(true), rideController.acceptRide);
router.post('/:id/arrive', rideOwner(true), rideController.arriveRide);
router.post('/:id/start', rideOwner(true), rideController.startRide);
router.post('/:id/complete', rideOwner(true), rideController.completeRide);
router.post('/:id/cancel', rideOwner(false), rideController.cancelRide);

export default router;
