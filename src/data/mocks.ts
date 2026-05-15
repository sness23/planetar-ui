import type { Channel, Server } from '@/types';

export const servers: Server[] = [
  { id: 'pac', name: 'Pacific Patrol', short: 'PP' },
  { id: 'arc', name: 'Arctic Watch', short: 'AW' },
  { id: 'trn', name: 'Training', short: 'TR' },
];

export const channels: Channel[] = [
  { id: 'pac-ais', serverId: 'pac', name: 'ais-anomalies', section: 'channels', unread: 3 },
  { id: 'pac-sar', serverId: 'pac', name: 'sar-detections', section: 'channels' },
  { id: 'pac-eo', serverId: 'pac', name: 'eo-chips', section: 'channels' },
  { id: 'pac-hyd', serverId: 'pac', name: 'hydrophone-alerts', section: 'channels', unread: 1 },
  { id: 'pac-rf', serverId: 'pac', name: 'rf-emitters', section: 'channels' },
  { id: 'pac-gen', serverId: 'pac', name: 'general', section: 'channels' },
  // Real per-vessel channels are populated dynamically by the AIS fleet
  // listener; keep one example thread + one alert for sidebar variety.
  { id: 'pac-t2', serverId: 'pac', name: 'sar-2026-05-13-08', section: 'threads' },
  { id: 'pac-a1', serverId: 'pac', name: 'dark-vessel-pacnw', section: 'alerts', unread: 2 },
];

export const defaultChannelByServer: Record<string, string> = {
  pac: 'pac-ais',
  arc: 'pac-gen',
  trn: 'pac-gen',
};
