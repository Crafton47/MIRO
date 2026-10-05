import request from 'supertest';
import app from '../src/app';

describe('Express REST API Endpoints', () => {
  test('GET /health returns 200 OK', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('POST /api/v1/rides/estimate calculates fare estimate', async () => {
    const res = await request(app).post('/api/v1/rides/estimate').send({
      pickupLat: 37.7749,
      pickupLng: -122.4194,
      destLat: 37.7833,
      destLng: -122.4167,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.estimatedFare).toBeGreaterThan(0);
  });

  test('POST /api/v1/rides/estimate returns 400 for out-of-bound lat/lng', async () => {
    const res = await request(app).post('/api/v1/rides/estimate').send({
      pickupLat: 999, // invalid latitude
      pickupLng: -122.4194,
      destLat: 37.7833,
      destLng: -122.4167,
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('GET /api/v1/simulator/status returns 200 with simulator info', async () => {
    const res = await request(app).get('/api/v1/simulator/status');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('isRunning');
  });
});
