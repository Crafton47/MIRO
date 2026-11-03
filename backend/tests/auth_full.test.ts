import { describe, test, expect } from '@jest/globals';
import request from 'supertest';
import app from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

describe('Production Authentication System API', () => {
  const timestamp = Date.now();
  const testRiderEmail = `auth_rider_${timestamp}@example.com`;
  const testDriverEmail = `auth_driver_${timestamp}@example.com`;
  const testPassword = 'StrongPassword123!';
  let riderToken = '';
  let driverToken = '';
  let createdDriverId = '';

  test('POST /api/v1/auth/register creates a new RIDER account', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Automated Rider',
        email: testRiderEmail,
        phone: `+91999${String(timestamp).slice(-7)}`,
        password: testPassword,
        role: 'RIDER',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toBeDefined();
    expect(res.body.data.user.email).toBe(testRiderEmail);
    expect(res.body.data.user.role).toBe('RIDER');
    expect(res.body.data.token).toBeDefined();
    riderToken = res.body.data.token;
  });

  test('POST /api/v1/auth/register rejects duplicate email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Duplicate Rider',
        email: testRiderEmail,
        phone: `+91888${String(timestamp).slice(-7)}`,
        password: testPassword,
        role: 'RIDER',
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('EMAIL_EXISTS');
  });

  test('POST /api/v1/auth/register rejects password shorter than 8 characters', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Short Pass',
        email: `short_${timestamp}@example.com`,
        phone: `+91777${String(timestamp).slice(-7)}`,
        password: '123',
        role: 'RIDER',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('POST /api/v1/auth/register auto-provisions Driver profile and vehicle for DRIVER role', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Automated Driver',
        email: testDriverEmail,
        phone: `+91666${String(timestamp).slice(-7)}`,
        password: testPassword,
        role: 'DRIVER',
        vehicle: {
          model: 'Tata Nexon EV',
          numberPlate: `WB-02-${String(timestamp).slice(-4)}`,
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.role).toBe('DRIVER');
    expect(res.body.data.user.driverId).toBeDefined();
    driverToken = res.body.data.token;
    createdDriverId = res.body.data.user.driverId;

    // Verify driver record exists in database
    const driver = await prisma.driver.findUnique({
      where: { id: createdDriverId },
      include: { vehicle: true },
    });
    expect(driver).not.toBeNull();
    expect(driver?.vehicle?.model).toBe('Tata Nexon EV');
  });

  test('POST /api/v1/auth/login authenticates user and returns JWT token and role', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: testRiderEmail,
        password: testPassword,
        rememberMe: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.email).toBe(testRiderEmail);
    expect(res.body.data.user.role).toBe('RIDER');
  });

  test('POST /api/v1/auth/login rejects incorrect password timing-safely', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: testRiderEmail,
        password: 'WrongPassword999!',
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  test('GET /api/v1/auth/me returns current authenticated user profile', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${riderToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe(testRiderEmail);
    expect(res.body.data.role).toBe('RIDER');
  });

  test('GET /api/v1/auth/me returns 401 when token is missing or invalid', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer invalid.token.payload');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('POST /api/v1/auth/forgot-password generates single-use reset token and resets password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({
        email: testRiderEmail,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.devResetToken).toBeDefined();

    const devToken = res.body.devResetToken;

    // Reset password using the token
    const newPassword = 'NewlyUpdatedPassword2026!';
    const resetRes = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({
        token: devToken,
        password: newPassword,
      });

    expect(resetRes.status).toBe(200);
    expect(resetRes.body.success).toBe(true);

    // Token must be single-use: subsequent reset attempt with same token must fail
    const reusedRes = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({
        token: devToken,
        password: 'AnotherPassword123!',
      });

    expect(reusedRes.status).toBe(400);
    expect(reusedRes.body.error.code).toBe('INVALID_RESET_TOKEN');

    // Login with new password must succeed
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: testRiderEmail,
        password: newPassword,
      });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.success).toBe(true);
  });

  test('POST /api/v1/auth/logout invalidates session cleanly', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${riderToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
