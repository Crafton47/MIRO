import { Router } from 'express';
import { simulatorController } from '../controllers/simulator.controller.js';
import { authService } from '../services/auth/auth.service.js';
import { demoEnabled } from '../config/security.js';

const router = Router();

router.use((req, res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (token) {
    try {
      req.user = authService.verifyToken(token);
      return next();
    } catch {}
  }
  if (demoEnabled) {
    return next();
  }
  res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
});

router.post('/start', simulatorController.start);
router.post('/stop', simulatorController.stop);
router.get('/status', simulatorController.getStatus);

export default router;
