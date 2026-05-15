// Map tab — MapLibre GL canvas backed by aisStore. Vessels render as a
// circle layer driven by a GeoJSON source that is re-set on every store
// change (cheap for O(100) vessels; revisit when we need O(10k)).
//
// Selection sync is bidirectional with the rest of the app:
//   click on a vessel  → setSelectedEntity(`MMSI ${mmsi}`)
//   selectedEntityId   → camera pans to that vessel, track polyline shown
//   current channel    → if its `vessel` is set, the same selection applies
//
// Tracked vessels (see @/types/ais TRACKED_MMSI) render with a distinct
// "tracked" style and the map flies to them on first sighting.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type Map as MapLibreMap, type MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAisPositions } from '@/hooks/useAisPositions';
import { parseMmsi, useAisStore } from '@/store/aisStore';
import { useChannelsStore } from '@/store/channelsStore';
import { useLayoutStore } from '@/store/layoutStore';
import { isTracked, TRACKED_MMSI } from '@/types/ais';
import type { VesselRecord } from '@/store/aisStore';

// Victoria BBox center (matches planetar-ais source-mock.mjs)
const INITIAL_CENTER: [number, number] = [-123.38, 48.42];
const INITIAL_ZOOM = 10;

const VESSEL_SOURCE = 'vessels';
const VESSEL_LAYER = 'vessel-dots';
const VESSEL_TRACKED_LAYER = 'vessel-tracked';
const TRACK_SOURCE = 'track';
const TRACK_LAYER = 'track-line';

const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
      paint: {
        // Slightly desaturated to keep the dark theme readable
        'raster-saturation': -0.35,
        'raster-brightness-min': 0.05,
        'raster-brightness-max': 0.85,
      },
    },
  ],
};

function vesselsToFeatureCollection(records: VesselRecord[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: records.map((r) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.latest.lon, r.latest.lat] },
      properties: {
        mmsi: r.mmsi,
        name: r.latest.name ?? `MMSI ${r.mmsi}`,
        sog: r.latest.sog ?? 0,
        cog: r.latest.cog ?? 0,
        status: r.status,
        tracked: isTracked(r.mmsi),
      },
    })),
  };
}

function trackToFeature(record: VesselRecord | undefined): GeoJSON.FeatureCollection {
  if (!record || record.track.length < 2) {
    return { type: 'FeatureCollection', features: [] };
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: record.track.map((p) => [p.lon, p.lat]),
        },
        properties: { mmsi: record.mmsi },
      },
    ],
  };
}

export function MapTab() {
  useAisPositions();

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const flownToTrackedRef = useRef<Set<number>>(new Set());

  // Follow mode: when true the camera tracks position updates for the selected
  // vessel; when false (user panned/zoomed/dragged) the camera stays put and a
  // "Recenter" button appears to re-engage tracking.
  const [followMode, setFollowMode] = useState(true);
  const prevSelectedMmsiRef = useRef<number | null>(null);

  const vessels = useAisStore((s) => s.byMmsi);
  const selectedEntityId = useLayoutStore((s) => s.selectedEntityId);
  const setSelectedEntity = useLayoutStore((s) => s.setSelectedEntity);
  const currentChannelId = useLayoutStore((s) => s.currentChannelId);
  const channel = useChannelsStore((s) => s.channels[currentChannelId]);

  /**
   * Resolve the currently selected MMSI from either the entity selection
   * (set by clicking a token in chat or a pin on the map) or the current
   * channel's vessel sidecar (set by clicking a #vessels channel).
   */
  const selectedMmsi = useMemo(() => {
    return parseMmsi(selectedEntityId) ?? parseMmsi(channel?.vessel?.mmsi);
  }, [selectedEntityId, channel?.vessel?.mmsi]);

  // ---------- map lifecycle ----------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'nautical', maxWidth: 120 }), 'bottom-left');

    map.on('load', () => {
      map.addSource(VESSEL_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addSource(TRACK_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: TRACK_LAYER,
        type: 'line',
        source: TRACK_SOURCE,
        paint: {
          'line-color': '#6fb6ff',
          'line-width': 2,
          'line-opacity': 0.85,
        },
      });
      map.addLayer({
        id: VESSEL_LAYER,
        type: 'circle',
        source: VESSEL_SOURCE,
        filter: ['!=', ['get', 'tracked'], true],
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            8, 3,
            14, 7,
          ],
          'circle-color': [
            'match', ['get', 'status'],
            'dark', '#ffb24a',
            'lost', '#5a647c',
            /* live default */ '#4ade80',
          ],
          'circle-stroke-color': '#0b101c',
          'circle-stroke-width': 1.5,
        },
      });
      map.addLayer({
        id: VESSEL_TRACKED_LAYER,
        type: 'circle',
        source: VESSEL_SOURCE,
        filter: ['==', ['get', 'tracked'], true],
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            8, 6,
            14, 12,
          ],
          'circle-color': '#ff6b6b',
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2.5,
        },
      });
    });

    const onClick = (e: MapMouseEvent) => {
      const layers = [VESSEL_TRACKED_LAYER, VESSEL_LAYER];
      const hits = map.queryRenderedFeatures(e.point, { layers });
      if (hits.length === 0) return;
      const feat = hits[0];
      const mmsi = feat.properties?.mmsi;
      if (typeof mmsi === 'number' || typeof mmsi === 'string') {
        setSelectedEntity(`MMSI ${mmsi}`);
      }
    };
    map.on('click', onClick);
    map.on('mouseenter', VESSEL_LAYER, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', VESSEL_LAYER, () => { map.getCanvas().style.cursor = ''; });
    map.on('mouseenter', VESSEL_TRACKED_LAYER, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', VESSEL_TRACKED_LAYER, () => { map.getCanvas().style.cursor = ''; });

    /*
     * Drop follow-mode the moment the user moves the camera themselves
     * (drag-pan, scroll-zoom, pinch). Programmatic easeTo/flyTo from our own
     * follow effect fire 'movestart' without an `originalEvent`, so they
     * don't trip this handler — that's the key distinction.
     */
    map.on('movestart', (e) => {
      if ((e as unknown as { originalEvent?: Event }).originalEvent) {
        setFollowMode(false);
      }
    });

    /*
     * MapLibre captures container dimensions at construction. The map lives
     * inside a PanelGroup that re-mounts on channel switch — and the new
     * channel's stored layout (per-channel pane widths) settles a frame or
     * two after the map's useEffect fires. The result is a canvas captured
     * at the wrong width: tiny on first paint (black rectangle), or stretched
     * horizontally if the data pane grew after construction.
     *
     * Defence: a ResizeObserver on the container fires whenever its size
     * shifts AND a small chain of sequential frame-and-timeout resizes
     * during the first ~300ms catches whatever the observer missed.
     */
    const ro = new ResizeObserver(() => map.resize());
    if (containerRef.current) ro.observe(containerRef.current);

    const rafIds: number[] = [];
    const timeoutIds: ReturnType<typeof setTimeout>[] = [];
    let cancelled = false;
    const settle = () => {
      if (cancelled) return;
      map.resize();
    };
    // Five sequential frames covers ~80 ms of layout settling at 60fps.
    const chain = (n: number) => {
      if (cancelled || n === 0) return;
      rafIds.push(requestAnimationFrame(() => {
        settle();
        chain(n - 1);
      }));
    };
    chain(5);
    // Plus two longer catch-ups for slow layout transitions.
    timeoutIds.push(setTimeout(settle, 150));
    timeoutIds.push(setTimeout(settle, 400));

    mapRef.current = map;
    return () => {
      cancelled = true;
      for (const id of rafIds) cancelAnimationFrame(id);
      for (const id of timeoutIds) clearTimeout(id);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [setSelectedEntity]);

  // ---------- channel change → schedule another round of resizes ----------
  // The PanelGroup is keyed on currentChannelId; in most cases this means a
  // fresh MapTab and the lifecycle effect above covers it. But if React
  // happens to reuse this MapTab instance (e.g. tab navigation that keeps
  // the same group identity), force the existing map to re-measure too.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const rafs: number[] = [];
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    let cancelled = false;
    const tick = () => { if (!cancelled) map.resize(); };
    rafs.push(requestAnimationFrame(() => { tick(); rafs.push(requestAnimationFrame(tick)); }));
    timeouts.push(setTimeout(tick, 100));
    timeouts.push(setTimeout(tick, 300));
    return () => {
      cancelled = true;
      for (const id of rafs) cancelAnimationFrame(id);
      for (const id of timeouts) clearTimeout(id);
    };
  }, [currentChannelId]);

  // ---------- vessel source updates ----------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource(VESSEL_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      const records = Object.values(vessels);
      src.setData(vesselsToFeatureCollection(records));
      // fly to a tracked vessel the first time it appears
      for (const r of records) {
        if (!isTracked(r.mmsi)) continue;
        if (flownToTrackedRef.current.has(r.mmsi)) continue;
        flownToTrackedRef.current.add(r.mmsi);
        map.flyTo({ center: [r.latest.lon, r.latest.lat], zoom: 12, speed: 0.8 });
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [vessels]);

  // ---------- track source (selected vessel only) ----------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource(TRACK_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      const rec = selectedMmsi != null ? vessels[selectedMmsi] : undefined;
      src.setData(trackToFeature(rec));
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [selectedMmsi, vessels]);

  // ---------- selection-change → recenter once + re-enable follow ----------
  useEffect(() => {
    if (selectedMmsi === prevSelectedMmsiRef.current) return;
    prevSelectedMmsiRef.current = selectedMmsi;
    if (selectedMmsi != null) setFollowMode(true);
  }, [selectedMmsi]);

  // ---------- while follow-mode is on, camera tracks position updates ----------
  useEffect(() => {
    if (!followMode || selectedMmsi == null) return;
    const map = mapRef.current;
    if (!map) return;
    const rec = vessels[selectedMmsi];
    if (!rec) return;
    map.easeTo({ center: [rec.latest.lon, rec.latest.lat], duration: 600, zoom: Math.max(map.getZoom(), 11) });
  }, [followMode, selectedMmsi, vessels]);

  const handleRecenter = useCallback(() => {
    const map = mapRef.current;
    if (!map || selectedMmsi == null) return;
    const rec = vessels[selectedMmsi];
    if (!rec) return;
    setFollowMode(true);
    map.easeTo({ center: [rec.latest.lon, rec.latest.lat], duration: 700, zoom: Math.max(map.getZoom(), 12) });
  }, [selectedMmsi, vessels]);

  const records = Object.values(vessels);
  const trackedSeen = records.some((r) => isTracked(r.mmsi));

  // Show the recenter button only when there's a vessel to recenter on AND
  // the user has wandered off it (follow mode disengaged).
  const recenterAvailable =
    selectedMmsi != null && vessels[selectedMmsi] != null && !followMode;
  const recenterLabel = (() => {
    if (selectedMmsi == null) return null;
    const v = vessels[selectedMmsi]?.latest;
    return v?.name ?? `MMSI ${selectedMmsi}`;
  })();

  return (
    <div className="map-tab">
      <div ref={containerRef} className="map-canvas" />
      <div className="map-legend">
        <span className="legend-dot live" /> live
        <span className="legend-dot dark" /> dark
        <span className="legend-dot lost" /> lost
        <span className="legend-dot tracked" /> tracked
        <span className="legend-spacer" />
        <span className="legend-count">{records.length} vessel{records.length === 1 ? '' : 's'}</span>
        {Array.from(TRACKED_MMSI).map((m) => (
          <span key={m} className={`legend-tracked-mmsi ${vessels[m] ? 'live' : 'pending'}`} title={vessels[m] ? 'on map' : 'awaiting position'}>
            {m}
          </span>
        ))}
        {!trackedSeen && TRACKED_MMSI.size > 0 ? (
          <span className="legend-note">tracked vessel not yet reported</span>
        ) : null}
      </div>
      {recenterAvailable ? (
        <button
          type="button"
          className="map-recenter"
          onClick={handleRecenter}
          title={`Recenter on ${recenterLabel ?? 'vessel'} and resume follow`}
        >
          <span className="map-recenter-glyph">⌖</span>
          Recenter
        </button>
      ) : null}
    </div>
  );
}
