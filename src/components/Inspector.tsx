import { useLayoutStore } from '@/store/layoutStore';

export function Inspector() {
  const selectedEntityId = useLayoutStore((s) => s.selectedEntityId);

  return (
    <div className="inspector">
      <div className="inspector-title">
        Inspector
        {selectedEntityId ? <span className="type">· vessel</span> : null}
      </div>
      {selectedEntityId ? (
        <>
          <div className="inspector-row">
            <span className="k">MMSI</span>
            <span className="v">{selectedEntityId}</span>
          </div>
          <div className="inspector-row">
            <span className="k">Class</span>
            <span className="v">—</span>
          </div>
          <div className="inspector-row">
            <span className="k">Flag</span>
            <span className="v">—</span>
          </div>
          <div className="inspector-row">
            <span className="k">Last AIS</span>
            <span className="v">—</span>
          </div>
          <div className="inspector-row">
            <span className="k">SAR match</span>
            <span className="v">—</span>
          </div>
        </>
      ) : (
        <div className="inspector-empty">No entity selected. Click a token in chat or a marker on the map.</div>
      )}
    </div>
  );
}
