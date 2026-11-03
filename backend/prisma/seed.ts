import { PrismaClient, Role, DriverStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo seeding is disabled in production');
  console.log('🌱 Seeding database with demo users, drivers, and vehicles...');

  const passwordHash = await bcrypt.hash('password123', 10);

  // 1. Create Demo Rider
  const riderUser = await prisma.user.upsert({
    where: { email: 'rider@miro.local' },
    update: {},
    create: {
      id: '11111111-1111-4000-a000-000000000001',
      name: 'Rohan Sen',
      email: 'rider@miro.local',
      phone: '+919830001111',
      passwordHash,
      role: Role.RIDER,
    },
  });
  console.log(`✅ Created Rider: ${riderUser.name} (${riderUser.id})`);

  // 2. Create Real Driver D1
  const realDriverUser = await prisma.user.upsert({
    where: { email: 'driver1@miro.local' },
    update: {},
    create: {
      id: '22222222-2222-4000-a000-000000000001',
      name: 'Debashis Mukherjee (D1)',
      email: 'driver1@miro.local',
      phone: '+919830002221',
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
          model: 'Maruti Suzuki Dzire',
          numberPlate: 'WB-02-GPS-1001',
        },
      },
    },
  });
  console.log(`✅ Created Real Driver (D1): ${realDriverUser.name} (${realDriver.id})`);

  // 3. Create 7 Simulated Drivers (D2 to D8)
  for (let i = 2; i <= 8; i++) {
    const email = `driver${i}@miro.local`;
    const driverId = `00000000-0000-4000-a000-00000000000${i}`;
    const userId = `22222222-2222-4000-a000-00000000000${i}`;

    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        id: userId,
        name: `Simulated Driver D${i}`,
        email,
        phone: `+91983000222${i}`,
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
            model: i % 2 === 0 ? 'Hyundai Aura' : 'Maruti Ertiga',
            numberPlate: `WB-02-SIM-200${i}`,
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
