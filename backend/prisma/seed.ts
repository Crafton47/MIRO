import { PrismaClient, Role, DriverStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database with demo users, drivers, and vehicles...');

  const passwordHash = await bcrypt.hash('password123', 10);

  // 1. Create Demo Rider
  const riderUser = await prisma.user.upsert({
    where: { email: 'rider@demo.com' },
    update: {},
    create: {
      id: '11111111-1111-4000-a000-000000000001',
      name: 'Demo Rider',
      email: 'rider@demo.com',
      phone: '+15550001111',
      passwordHash,
      role: Role.RIDER,
    },
  });
  console.log(`✅ Created Rider: ${riderUser.name} (${riderUser.id})`);

  // 2. Create Real Driver D1
  const realDriverUser = await prisma.user.upsert({
    where: { email: 'driver1@demo.com' },
    update: {},
    create: {
      id: '22222222-2222-4000-a000-000000000001',
      name: 'Real Driver (D1)',
      email: 'driver1@demo.com',
      phone: '+15550002221',
      passwordHash,
      role: Role.DRIVER,
    },
  });

  const realDriver = await prisma.driver.upsert({
    where: { userId: realDriverUser.id },
    update: {},
    create: {
      id: '00000000-0000-4000-a000-000000000001',
      userId: realDriverUser.id,
      status: DriverStatus.ONLINE,
      rating: 4.9,
      vehicle: {
        create: {
          vehicleType: 'SEDAN',
          model: 'Toyota Camry 2024',
          numberPlate: 'REAL-GPS-1',
        },
      },
    },
  });
  console.log(`✅ Created Real Driver (D1): ${realDriverUser.name} (${realDriver.id})`);

  // 3. Create 7 Simulated Drivers (D2 to D8)
  for (let i = 2; i <= 8; i++) {
    const email = `driver${i}@demo.com`;
    const driverId = `00000000-0000-4000-a000-00000000000${i}`;
    const userId = `22222222-2222-4000-a000-00000000000${i}`;

    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        id: userId,
        name: `Simulated Driver D${i}`,
        email,
        phone: `+1555000222${i}`,
        passwordHash,
        role: Role.DRIVER,
      },
    });

    const driver = await prisma.driver.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        id: driverId,
        userId: user.id,
        status: DriverStatus.ONLINE,
        rating: 4.5 + (i % 5) * 0.1,
        vehicle: {
          create: {
            vehicleType: i % 2 === 0 ? 'SEDAN' : 'SUV',
            model: `Simulated Car Model ${i}`,
            numberPlate: `SIM-800-${i}`,
          },
        },
      },
    });
    console.log(`✅ Created Simulated Driver D${i}: ${user.name} (${driver.id})`);
  }

  console.log('🎉 Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
