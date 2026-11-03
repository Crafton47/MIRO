// A single Redis operation orders GPS packets and moves all availability indexes.
// This application uses standalone Redis; dynamically addressed H3 sets are not
// compatible with Redis Cluster hash-slot restrictions.
export const locationUpdateScript = `
local key = KEYS[1]
local driver = ARGV[1]
local incoming = tonumber(ARGV[2])
local previous = tonumber(redis.call('HGET', key, 'updatedAt') or '0')
if incoming < previous then return redis.call('HGETALL', key) end
local oldCell = redis.call('HGET', key, 'h3Index')
local status = ARGV[3]
if status == '' then status = redis.call('HGET', key, 'status') or 'ONLINE' end
for i = 4, #ARGV, 2 do redis.call('HSET', key, ARGV[i], ARGV[i + 1]) end
redis.call('HSET', key, 'status', status)
local cell = redis.call('HGET', key, 'h3Index')
if oldCell and oldCell ~= cell then redis.call('SREM', 'h3:' .. oldCell .. ':drivers', driver) end
if status == 'ONLINE' then
  redis.call('SADD', 'h3:' .. cell .. ':drivers', driver)
  redis.call('SADD', 'drivers:online', driver)
else
  redis.call('SREM', 'h3:' .. cell .. ':drivers', driver)
  redis.call('SREM', 'drivers:online', driver)
end
return redis.call('HGETALL', key)
`;

export async function writeLocation(redis: any, driverId: string, fields: Record<string, string>) {
  if (typeof redis.atomicLocationUpdate === 'function') return redis.atomicLocationUpdate(driverId, fields);
  const values: string[] = await redis.eval(locationUpdateScript, 1, `driver:location:${driverId}`,
    driverId, fields.updatedAt, fields.status, ...Object.entries(fields).flat());
  const result: Record<string, string> = {};
  for (let i = 0; i < values.length; i += 2) result[values[i]] = values[i + 1];
  return result;
}
