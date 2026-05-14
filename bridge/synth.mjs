// Synthetic chatter publisher. Connects to planetar-broker producer port and
// emits realistic zmesg envelopes per channel topic, so the demo has live
// traffic without a human typing in the UI. Just another producer — the
// broker is content-agnostic; bridge sees these via its SUB ** and fans out.

import net from 'node:net';
import { v7 as uuidv7 } from 'uuid';
import { encodeEnvelope, frameTCP } from './zmesg.mjs';

const BROKER_HOST = process.env.BROKER_HOST ?? '127.0.0.1';
const BROKER_PUB_PORT = Number(process.env.BROKER_PUB_PORT ?? 12001);

const TOPICS = [
  'chat.pac.ais-anomalies',
  'chat.pac.sar-detections',
  'chat.pac.eo-chips',
  'chat.pac.hydrophone-alerts',
  'chat.pac.rf-emitters',
  'chat.pac.general',
];

const PERSONAS = [
  { id: 'op-aleph',   name: 'aleph',   role: 'analyst' },
  { id: 'op-beth',    name: 'beth',    role: 'analyst' },
  { id: 'op-gimel',   name: 'gimel',   role: 'watch'   },
  { id: 'agent-asr',  name: 'asr',     role: 'agent'   },
  { id: 'agent-fuse', name: 'fuse',    role: 'agent'   },
];

const PHRASES = {
  'ais-anomalies': [
    'AIS gap on ⟦MMSI 477123400⟧ — 41 min, last seen 48.42N 123.18W',
    'speed drop on ⟦MMSI 538009876⟧, sliding under 2 kn near Active Pass',
    'fresh dark zone west of Pachena Pt, 3 vessels lost in last hour',
    'class A pings from ⟦MMSI 311045221⟧ in the SAR-only window — odd',
    'consolidating yesterday into a thread, see ⟦CASE-PNW-0512⟧',
  ],
  'sar-detections': [
    'Sentinel-1 IW pass 14:02Z — 7 detections, 2 unmatched',
    'detection cluster off La Pérouse, footprint ⟦SAR-2026-05-13-08⟧',
    'no AIS within 8 nm of detection at 49.01N 125.71W',
    'reprocessed with looser threshold, +3 hits',
  ],
  'eo-chips': [
    'Planet SkySat chips queued for the 3 dark candidates',
    'cloud at 70% over the western box, waiting on next pass',
    '⟦MMSI 477123400⟧ candidate chip looks like a 200m bulker — flag class mismatch',
  ],
  'hydrophone-alerts': [
    'ONC node Folger Pt: tonal at 110 Hz, 12 min, drifting south',
    'low-freq thrum at Barkley node — engine, not whale',
    'no correlated AIS, hand-flagging',
  ],
  'rf-emitters': [
    'X-band burst detected at 48.91N 124.55W, ~3.2 GHz',
    'AIS-class B transmitter active without registered MMSI',
  ],
  'general': [
    'morning all, watch starts at 14Z',
    'standing up the dark-vessel board for the week',
    '⟦ONC⟧ node feed is back up',
  ],
};

let sock = null;
let connected = false;

function connect() {
  sock = net.connect({ host: BROKER_HOST, port: BROKER_PUB_PORT });
  sock.setNoDelay(true);
  sock.once('connect', () => {
    connected = true;
    console.log(`[synth] connected to broker ${BROKER_HOST}:${BROKER_PUB_PORT}`);
  });
  sock.once('close', () => {
    if (connected) console.log('[synth] disconnected; retrying in 2s');
    connected = false;
    sock = null;
    setTimeout(connect, 2000);
  });
  sock.once('error', (e) => {
    if (connected) console.log(`[synth] error: ${e.message}`);
    try { sock?.destroy(); } catch { /* ignore */ }
  });
}

function publish(topic) {
  if (!sock || !connected || !sock.writable) return;
  const persona = PERSONAS[Math.floor(Math.random() * PERSONAS.length)];
  const tail = topic.split('.').pop();
  const list = PHRASES[tail] ?? PHRASES.general;
  const text = list[Math.floor(Math.random() * list.length)];
  const now = String(BigInt(Date.now()) * 1_000_000n);
  try {
    const buf = encodeEnvelope({
      id: uuidv7(),
      topic,
      source: persona.id,
      schemaName: 'chat.v1.Message',
      schemaVersion: 1,
      createdAtNs: now,
      storedAtNs: now,
      publishedAtNs: now,
      payload: { text, author: { id: persona.id, name: persona.name, role: persona.role } },
    });
    sock.write(frameTCP(buf));
  } catch (e) {
    console.log(`[synth] publish failed: ${e.message}`);
  }
}

connect();

for (const t of TOPICS) {
  const tick = () => {
    publish(t);
    setTimeout(tick, 4000 + Math.floor(Math.random() * 11000));
  };
  setTimeout(tick, 500 + Math.floor(Math.random() * 1500));
}

process.on('SIGINT', () => process.exit(0));
