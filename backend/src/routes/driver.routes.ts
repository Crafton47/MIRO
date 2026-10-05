import { Router } from 'express';
import { driverController } from '../controllers/driver.controller.js';

const router = Router();

router.post('/', driverController.createDriver);
router.get('/nearby', driverController.getNearbyDrivers);
router.get('/:id', driverController.getDriverById);
router.patch('/:id/status', driverController.updateStatus);
router.patch('/:id/location', driverController.updateLocation);

export default router;
