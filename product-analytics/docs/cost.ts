const monthDays = 30;
const eventsPerRequest = 4;
const cpuMsPerRequest = 2;
const retentionMonths = 6;
const oneMillion = 1_000_000;
const gb = 1_000_000_000;
const positive = (value: number) => Math.max(0, value);

function workerCost(requests: number, paid: boolean) {
  if (!paid && Math.ceil(requests / monthDays) <= 100_000) return 0;
  return 5 + positive(requests - 10 * oneMillion) / oneMillion * 0.30
    + positive(requests * cpuMsPerRequest - 30 * oneMillion) / oneMillion * 0.02;
}

function r2Cost(storedGb: number, classA: number, classB: number) {
  return positive(Math.ceil(storedGb) - 10) * 0.015
    + positive(Math.ceil(classA / oneMillion) - 1) * 4.50
    + positive(Math.ceil(classB / oneMillion) - 10) * 0.36;
}

console.table([100_000, 1_000_000, 10_000_000, 100_000_000].map((events) => {
  const requests = Math.ceil(events / eventsPerRequest);
  const processedGb = events * 1200 / gb;
  const basin = positive(processedGb - 50) * (0.04 + 0.06);
  const parquetGb = events * 150 * retentionMonths / gb;
  const rawGb = events * 450 * retentionMonths / gb;
  // One R2 put per accepted POST and one GET per object for incremental copying.
  const rawA = requests + Math.ceil(requests / 1000);
  const direct = workerCost(requests, false) + r2Cost(rawGb, rawA, requests);
  // Assume the roll interval and read volume stay within the included allowance.
  const standardBasin = workerCost(requests, true) + basin + r2Cost(parquetGb, 100_000, 5_000_000);
  return { events, requests, processedGb, parquetGb, rawGb, basinUsd: standardBasin.toFixed(2), directUsd: direct.toFixed(2) };
}));
