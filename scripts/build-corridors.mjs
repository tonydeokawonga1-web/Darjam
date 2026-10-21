/**
 * Build the Dar es Salaam corridor dataset.
 *
 * Road geometry comes from OpenStreetMap's public OSRM router (demo server).
 * We store a static snapshot so the app runs without any routing service at
 * runtime. Re-run with `npm run build:data` to refresh the geometry.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'server', 'data', 'corridors.json');
const OSRM = 'https://router.project-osrm.org/route/v1/driving';
const CBD = { lat: -6.81463, lng: 39.28799 };

const STOPS = {
  posta: { name: 'Posta', lat: -6.81463, lng: 39.28799 },
  askari: { name: 'Askari Monument', lat: -6.81663, lng: 39.28948 },
  kariakoo: { name: 'Kariakoo', lat: -6.81929, lng: 39.2753 },
  fire: { name: 'Fire', lat: -6.81222, lng: 39.27401 },
  magomeni: { name: 'Magomeni', lat: -6.80358, lng: 39.26046 },
  manzese: { name: 'Manzese', lat: -6.79638, lng: 39.2309 },
  ubungo: { name: 'Ubungo', lat: -6.7918, lng: 39.21122 },
  kimara: { name: 'Kimara', lat: -6.79605, lng: 39.18072 },
  mbeziLuis: { name: 'Mbezi Luis', lat: -6.78603, lng: 39.1123 },
  ilala: { name: 'Ilala', lat: -6.8209, lng: 39.28642 },
  vingunguti: { name: 'Vingunguti', lat: -6.84611, lng: 39.22736 },
  kipawa: { name: 'Kipawa', lat: -6.86613, lng: 39.19647 },
  ukonga: { name: 'Ukonga', lat: -6.8753, lng: 39.1693 },
  gongo: { name: 'Gongo la Mboto', lat: -6.88133, lng: 39.15835 },
  airport: { name: 'JNIA Airport', lat: -6.87419, lng: 39.20752 },
  tazara: { name: 'Tazara', lat: -6.84641, lng: 39.24503 },
  temeke: { name: 'Temeke', lat: -6.85097, lng: 39.25672 },
  changombe: { name: "Chang'ombe", lat: -6.84295, lng: 39.26265 },
  mbagala: { name: 'Mbagala', lat: -6.90011, lng: 39.26435 },
  rangiTatu: { name: 'Rangi Tatu', lat: -6.91421, lng: 39.27072 },
  kigamboni: { name: 'Kigamboni', lat: -6.82549, lng: 39.30941 },
  selander: { name: 'Selander Bridge', lat: -6.79621, lng: 39.28137 },
  kijitonyama: { name: 'Kijitonyama', lat: -6.77666, lng: 39.24339 },
  mwenge: { name: 'Mwenge', lat: -6.76666, lng: 39.23134 },
  mbeziBeach: { name: 'Mbezi Beach', lat: -6.72851, lng: 39.23711 },
  oysterBay: { name: 'Oyster Bay', lat: -6.75457, lng: 39.27293 },
  masaki: { name: 'Masaki', lat: -6.75762, lng: 39.27683 },
  tegeta: { name: 'Tegeta', lat: -6.67413, lng: 39.18416 },
  mwananyamala: { name: 'Mwananyamala', lat: -6.78889, lng: 39.2584 },
  tabata: { name: 'Tabata', lat: -6.82815, lng: 39.22621 },
  kigogo: { name: 'Kigogo', lat: -6.81867, lng: 39.24599 },
};

const CORRIDORS = [
  {
    id: 'nyerere-road',
    name: 'Nyerere Road',
    swahili: 'Barabara ya Nyerere',
    from: 'Posta',
    to: 'JNIA Airport',
    description: 'The airport artery through Ilala, Vingunguti and Kipawa.',
    bias: 0.82,
    stops: ['posta', 'ilala', 'vingunguti', 'kipawa', 'airport'],
    segments: [
      { freeFlowKph: 32, baseLoad: 0.98 },
      { freeFlowKph: 42, baseLoad: 0.92 },
      { freeFlowKph: 52, baseLoad: 0.8 },
      { freeFlowKph: 58, baseLoad: 0.62 },
    ],
  },
  {
    id: 'morogoro-road',
    name: 'Morogoro Road',
    swahili: 'Barabara ya Morogoro',
    from: 'Kariakoo',
    to: 'Mbezi Luis',
    description: 'The busiest western gateway: Kariakoo, Magomeni, Ubungo, Kimara.',
    bias: 0.9,
    stops: ['kariakoo', 'fire', 'magomeni', 'manzese', 'ubungo', 'kimara', 'mbeziLuis'],
    segments: [
      { freeFlowKph: 28, baseLoad: 1.08 },
      { freeFlowKph: 40, baseLoad: 1.02 },
      { freeFlowKph: 46, baseLoad: 0.95 },
      { freeFlowKph: 52, baseLoad: 0.86 },
      { freeFlowKph: 58, baseLoad: 0.68 },
      { freeFlowKph: 62, baseLoad: 0.5 },
    ],
  },
  {
    id: 'ali-hassan-mwinyi',
    name: 'Ali Hassan Mwinyi Road',
    swahili: 'Barabara ya Ali Hassan Mwinyi',
    from: 'Selander Bridge',
    to: 'Mwenge',
    description: 'Upanga and Kijitonyama link to the Mwenge interchange.',
    bias: 0.84,
    stops: ['selander', 'kijitonyama', 'mwenge'],
    segments: [
      { freeFlowKph: 42, baseLoad: 0.96 },
      { freeFlowKph: 48, baseLoad: 0.9 },
    ],
  },
  {
    id: 'bagamoyo-road',
    name: 'Bagamoyo Road',
    swahili: 'Barabara ya Bagamoyo',
    from: 'Selander Bridge',
    to: 'Tegeta',
    description: 'Coastal northern corridor via Oyster Bay, Mbezi Beach and Tegeta.',
    bias: 0.78,
    stops: ['selander', 'oysterBay', 'mbeziBeach', 'tegeta'],
    segments: [
      { freeFlowKph: 38, baseLoad: 0.9 },
      { freeFlowKph: 50, baseLoad: 0.84 },
      { freeFlowKph: 58, baseLoad: 0.66 },
    ],
  },
  {
    id: 'kilwa-road',
    name: 'Kilwa Road',
    swahili: 'Barabara ya Kilwa',
    from: 'Kariakoo',
    to: 'Rangi Tatu',
    description: 'Southern corridor through Chang\'ombe, Temeke and Mbagala.',
    bias: 0.82,
    stops: ['kariakoo', 'changombe', 'temeke', 'mbagala', 'rangiTatu'],
    segments: [
      { freeFlowKph: 34, baseLoad: 0.95 },
      { freeFlowKph: 42, baseLoad: 0.9 },
      { freeFlowKph: 50, baseLoad: 0.82 },
      { freeFlowKph: 54, baseLoad: 0.64 },
    ],
  },
  {
    id: 'mandela-road',
    name: 'Mandela Road',
    swahili: 'Barabara ya Mandela',
    from: 'Tazara',
    to: 'Mbagala',
    description: 'East–south link between Nyerere Road and Kilwa Road.',
    bias: 0.5,
    stops: ['tazara', 'mbagala'],
    segments: [{ freeFlowKph: 54, baseLoad: 0.66 }],
  },
  {
    id: 'sam-nujoma',
    name: 'Sam Nujoma Road',
    swahili: 'Barabara ya Sam Nujoma',
    from: 'Mwenge',
    to: 'Tabata',
    description: 'Cross-city link serving Sinza, Mwananyamala and Tabata.',
    bias: 0.45,
    stops: ['mwenge', 'tabata'],
    segments: [{ freeFlowKph: 46, baseLoad: 0.78 }],
  },
  {
    id: 'kawawa-road',
    name: 'Kawawa Road',
    swahili: 'Barabara ya Kawawa',
    from: 'Fire',
    to: 'Mwananyamala',
    description: 'Kinondoni connector via Kigogo and Tandale.',
    bias: 0.4,
    stops: ['fire', 'kigogo', 'mwananyamala'],
    segments: [
      { freeFlowKph: 38, baseLoad: 0.82 },
      { freeFlowKph: 44, baseLoad: 0.74 },
    ],
  },
  {
    id: 'kigamboni-bridge',
    name: 'Nyerere Bridge',
    swahili: 'Daraja la Nyerere',
    from: 'Tazara',
    to: 'Kigamboni',
    description: 'Toll bridge across the Kurasini creek to Kigamboni.',
    bias: 0.55,
    stops: ['tazara', 'kigamboni'],
    segments: [{ freeFlowKph: 60, baseLoad: 0.55 }],
  },
  {
    id: 'uhuru-street',
    name: 'Uhuru Street',
    swahili: 'Mtaa wa Uhuru',
    from: 'Posta',
    to: 'Kariakoo',
    description: 'CBD shopping and market street.',
    bias: 0.3,
    stops: ['posta', 'askari', 'kariakoo'],
    segments: [
      { freeFlowKph: 22, baseLoad: 0.9 },
      { freeFlowKph: 24, baseLoad: 1.0 },
    ],
  },
  {
    id: 'msasani-road',
    name: 'Haile Selassie Road',
    swahili: 'Barabara ya Haile Selassie',
    from: 'Selander Bridge',
    to: 'Oyster Bay',
    description: 'Peninsula route through Masaki and Oyster Bay.',
    bias: 0.6,
    stops: ['selander', 'masaki', 'oysterBay'],
    segments: [
      { freeFlowKph: 36, baseLoad: 0.78 },
      { freeFlowKph: 34, baseLoad: 0.7 },
    ],
  },
  {
    id: 'nyerere-south',
    name: 'Nyerere Road South',
    swahili: 'Barabara ya Nyerere Kusini',
    from: 'Kipawa',
    to: 'Gongo la Mboto',
    description: 'Outer Nyerere Road towards Ukonga and Gongo la Mboto.',
    bias: 0.7,
    stops: ['kipawa', 'ukonga', 'gongo'],
    segments: [
      { freeFlowKph: 56, baseLoad: 0.68 },
      { freeFlowKph: 58, baseLoad: 0.55 },
    ],
  },
];

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRoute(a, b, attempt = 1) {
  const url = `${OSRM}/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson&alternatives=false&steps=false`;
  const res = await fetch(url, { headers: { 'User-Agent': 'DarJam/1.0 (corridor builder)' } });
  if (!res.ok) {
    if (attempt <= 3) {
      await sleep(1500 * attempt);
      return fetchRoute(a, b, attempt + 1);
    }
    throw new Error(`OSRM ${res.status} for ${a.name} -> ${b.name}`);
  }
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.length) {
    throw new Error(`No route ${a.name} -> ${b.name}: ${data.code}`);
  }
  return data.routes[0];
}

function midpoint(coords) {
  return coords[Math.floor(coords.length / 2)];
}

const output = {
  generatedAt: new Date().toISOString(),
  source: 'OpenStreetMap via OSRM demo router',
  city: { name: 'Dar es Salaam', center: [-6.8036, 39.2534], cbd: CBD },
  corridors: [],
};

let calls = 0;
for (const c of CORRIDORS) {
  const segments = [];
  for (let i = 0; i < c.stops.length - 1; i += 1) {
    const a = STOPS[c.stops[i]];
    const b = STOPS[c.stops[i + 1]];
    const meta = c.segments[i];
    if (!meta) throw new Error(`Missing segment meta for ${c.id} #${i}`);
    process.stdout.write(`${c.id}: ${a.name} -> ${b.name} ... `);
    const route = await fetchRoute(a, b);
    calls += 1;
    const coords = route.geometry.coordinates.map(([lng, lat]) => [
      Number(lat.toFixed(5)),
      Number(lng.toFixed(5)),
    ]);
    const lengthKm = Math.max(0.1, Math.round((route.distance / 1000) * 100) / 100);
    const mid = midpoint(coords);
    segments.push({
      id: `${c.id}-${i + 1}`,
      from: a.name,
      to: b.name,
      lengthKm,
      freeFlowKph: meta.freeFlowKph,
      baseLoad: meta.baseLoad,
      midpoint: mid,
      inboundIsForward: haversineKm(mid, CBD) > haversineKm(a, CBD),
      geometry: coords,
    });
    console.log(`${lengthKm} km, ${coords.length} pts`);
    await sleep(900);
  }
  output.corridors.push({
    id: c.id,
    name: c.name,
    swahili: c.swahili,
    from: c.from,
    to: c.to,
    description: c.description,
    bias: c.bias,
    segments,
  });
}

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`\nWrote ${output.corridors.length} corridors / ${output.corridors.reduce((n, c) => n + c.segments.length, 0)} segments to ${OUT} (${calls} OSRM calls).`);
