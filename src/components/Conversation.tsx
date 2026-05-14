import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useBroker } from '@/hooks/useBroker';
import { useChannelMessages } from '@/hooks/useChannelMessages';
import { chatTopic } from '@/lib/topic';
import { useChannelsStore } from '@/store/channelsStore';
import { useLayoutStore } from '@/store/layoutStore';
import type { VesselSummary } from '@/types';
import type { ChatPayload, ZmesgEnvelope } from '@/types/zmesg';
import { isChatEnvelope } from '@/types/zmesg';

const SELF_SOURCE = 'ui:you';
const SELF_NAME = 'you';

function formatTime(ns: string): string {
  try {
    const ms = Number(BigInt(ns) / 1_000_000n);
    const d = new Date(ms);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch {
    return '—:—';
  }
}

function initialsFor(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

const ENTITY_RX = /⟦([^⟧]+)⟧/g;

function renderBody(text: string, onPick: (id: string) => void) {
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  ENTITY_RX.lastIndex = 0;
  while ((m = ENTITY_RX.exec(text))) {
    if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
    const id = m[1];
    parts.push(
      <span
        key={`${m.index}-${id}`}
        className="entity-token"
        onClick={() => onPick(id)}
        title={`Focus ${id}`}
      >
        ⟦{id}⟧
      </span>,
    );
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}

function statusText(status: 'connecting' | 'open' | 'closed') {
  if (status === 'open') return 'bus · live';
  if (status === 'connecting') return 'bus · connecting';
  return 'bus · offline';
}

function formatLatLon(lat: number, lon: number) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}${ns} ${Math.abs(lon).toFixed(4)}${ew}`;
}

function ageOf(ns?: string): string {
  if (!ns) return '—';
  try {
    const ms = Number(BigInt(ns) / 1_000_000n);
    const dt = Date.now() - ms;
    if (dt < 0) return 'now';
    if (dt < 1000) return 'now';
    if (dt < 60_000) return `${Math.floor(dt / 1000)}s ago`;
    if (dt < 3_600_000) return `${Math.floor(dt / 60_000)}m ago`;
    return `${Math.floor(dt / 3_600_000)}h ago`;
  } catch {
    return '—';
  }
}

function VesselPin({ vessel }: { vessel: VesselSummary }) {
  const status = vessel.status ?? 'live';
  const moored = typeof vessel.sog === 'number' && vessel.sog < 0.3;
  return (
    <div className={`vessel-pin vessel-pin-${status}`}>
      <div className="vessel-pin-head">
        <span className="vessel-pin-name">{vessel.name}</span>
        <span className="vessel-pin-mmsi">MMSI {vessel.mmsi}</span>
        {vessel.type ? <span className="vessel-pin-chip">{vessel.type}</span> : null}
        {vessel.flag ? <span className="vessel-pin-chip">{vessel.flag}</span> : null}
        <span className="vessel-pin-spacer" />
        <span className={`vessel-pin-status vessel-pin-status-${status}`}>
          {status === 'lost' ? 'lost' : status === 'dark' ? 'AIS dark' : moored ? 'moored' : 'live'}
        </span>
      </div>
      <div className="vessel-pin-row">
        <span className="vessel-pin-label">pos</span>
        <span className="vessel-pin-value">
          {typeof vessel.lat === 'number' && typeof vessel.lon === 'number'
            ? formatLatLon(vessel.lat, vessel.lon)
            : '—'}
        </span>
        <span className="vessel-pin-label">sog</span>
        <span className="vessel-pin-value">
          {typeof vessel.sog === 'number' ? `${vessel.sog.toFixed(1)} kn` : '—'}
        </span>
        <span className="vessel-pin-label">cog</span>
        <span className="vessel-pin-value">
          {typeof vessel.cog === 'number' ? `${Math.round(vessel.cog)}°` : '—'}
        </span>
        {vessel.destination ? (
          <>
            <span className="vessel-pin-label">dest</span>
            <span className="vessel-pin-value">⟦{vessel.destination}⟧</span>
          </>
        ) : null}
        <span className="vessel-pin-spacer" />
        <span className="vessel-pin-age">last AIS · {ageOf(vessel.lastSeenNs)}</span>
      </div>
    </div>
  );
}

export function Conversation() {
  const currentChannelId = useLayoutStore((s) => s.currentChannelId);
  const headerVisible = useLayoutStore((s) => s.paneVisibility.header);
  const noteInteraction = useLayoutStore((s) => s.noteInteraction);
  const setSelectedEntity = useLayoutStore((s) => s.setSelectedEntity);

  const channel = useChannelsStore((s) => s.channels[currentChannelId]);
  const topic = useMemo(() => (channel ? chatTopic(channel) : null), [channel]);

  const envelopes = useChannelMessages(topic);
  const { status, publish } = useBroker();

  const [draft, setDraft] = useState('');
  const streamRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new envelopes arrive
  useLayoutEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [envelopes.length, topic]);

  // Reset draft on channel switch
  useEffect(() => {
    setDraft('');
  }, [topic]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic || !draft.trim()) return;
    const payload: ChatPayload = {
      text: draft.trim(),
      author: { id: SELF_SOURCE, name: SELF_NAME, role: 'operator' },
    };
    publish({
      topic,
      source: SELF_SOURCE,
      schemaName: 'chat.v1.Message',
      payload,
    });
    setDraft('');
  };

  return (
    <section className="pane conversation" onMouseDown={() => noteInteraction('conversation')}>
      {headerVisible && (
        <header className="pane-header">
          <span className="ph-section">#</span>
          <span className="ph-title">{channel?.name ?? '—'}</span>
          <span className="ph-spacer" />
          <span className={`status-dot ${status === 'open' ? '' : 'offline'}`} />
          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>
            {statusText(status)}
          </span>
        </header>
      )}
      <div className="conv-stream" ref={streamRef}>
        {channel?.vessel ? <VesselPin vessel={channel.vessel} /> : null}
        {envelopes.length === 0 && !channel?.vessel ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--mono)', padding: '8px 0' }}>
            no envelopes yet on <code>{topic}</code> — waiting for traffic.
          </div>
        ) : null}
        {envelopes.map((env: ZmesgEnvelope) => {
          if (!isChatEnvelope(env)) {
            // Render unknown schema as raw envelope summary
            return (
              <div key={env.id} className="conv-msg">
                <div className="conv-avatar">??</div>
                <div className="conv-content">
                  <div className="conv-meta">
                    <span className="conv-author">{env.source}</span>
                    <span className="conv-time">{formatTime(env.createdAtNs)}</span>
                    <span className="conv-time">· {env.schemaName}</span>
                  </div>
                  <div className="conv-body" style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-dim)' }}>
                    {JSON.stringify(env.payload)}
                  </div>
                </div>
              </div>
            );
          }
          const { text, author } = env.payload;
          return (
            <div key={env.id} className="conv-msg">
              <div className="conv-avatar">{initialsFor(author.name)}</div>
              <div className="conv-content">
                <div className="conv-meta">
                  <span className="conv-author">{author.name}</span>
                  <span className="conv-time">{formatTime(env.createdAtNs)}</span>
                  {author.role ? <span className="conv-time">· {author.role}</span> : null}
                </div>
                <div className="conv-body">{renderBody(text, setSelectedEntity)}</div>
              </div>
            </div>
          );
        })}
      </div>
      <form className="conv-input" onSubmit={onSubmit}>
        <input
          id="message-input"
          placeholder={topic ? `Message #${channel?.name ?? ''}` : 'select a channel'}
          autoComplete="off"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!topic || status !== 'open'}
        />
      </form>
    </section>
  );
}
