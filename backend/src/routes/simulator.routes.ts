import { Router } from 'express';
import { simulatorController } from '../controllers/simulator.controller.js';

import { authenticate } from '../middleware/auth.middleware.js';
const router = Router();
router.use(authenticate);

router.post('/start', simulatorController.start);
router.post('/stop', simulatorController.stop);
router.get('/status', simulatorController.getStatus);

export default router;
