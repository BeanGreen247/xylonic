import React from 'react';
import AlbumArt from './AlbumArt';
import './FlowingBackdrop.css';

interface FlowingBackdropProps {
  /** Adds a heavily blurred copy of this cover for the song's own colours. */
  coverArtId?: string;
  /** Drift only while something is playing; paused, the layers sit still and cost nothing. */
  live: boolean;
  className?: string;
}

/**
 * Slow-drifting theme-coloured gradient behind a full-screen player. Opacity and
 * halo strength follow `--beat` (0..1) when an ancestor sets it, e.g. Car Mode.
 */
const FlowingBackdrop: React.FC<FlowingBackdropProps> = ({ coverArtId, live, className = '' }) => (
  <div className={`flow-backdrop${live ? ' is-live' : ''} ${className}`} aria-hidden="true">
    {coverArtId && (
      <div className="flow-backdrop-art"><AlbumArt coverArtId={coverArtId} alt="" /></div>
    )}
    <span className="flow-blob flow-blob-a" />
    <span className="flow-blob flow-blob-b" />
    <span className="flow-blob flow-blob-c" />
    <span className="flow-vignette" />
  </div>
);

export default React.memo(FlowingBackdrop);
