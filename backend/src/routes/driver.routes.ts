import { Router } from 'express';
import { driverController } from '../controllers/driver.controller.js';

import { authenticate } from '../middleware/auth.middleware.js';
import { driverOwner, driverIdentity } from '../middleware/ownership.middleware.js';
const router = Router();
router.use(authenticate);

router.post('/', driverIdentity, driverController.createDriver);
router.get('/nearby', driverController.getNearbyDrivers);
router.get('/:id', driverOwner, driverController.getDriverById);
router.patch('/:id/status', driverOwner, driverController.updateStatus);
router.patch('/:id/location', driverOwner, driverController.updateLocation);

export default router;
