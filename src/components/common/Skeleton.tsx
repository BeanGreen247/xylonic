import React from 'react';
import './Skeleton.css';

interface SkeletonProps {
    /** `grid` mirrors the artist/album card grids; `list` mirrors the song rows. */
    variant: 'grid' | 'list';
    count?: number;
}

/**
 * Placeholder shown while a library list/grid is loading. Purely decorative —
 * the wrapper carries the loading announcement, the shapes are aria-hidden.
 */
const Skeleton: React.FC<SkeletonProps> = ({ variant, count }) => {
    const n = count ?? (variant === 'grid' ? 12 : 10);
    const items = Array.from({ length: n });

    return (
        <div
            className={`lib-skeleton lib-skeleton-${variant}`}
            role="status"
            aria-label="Loading"
            aria-busy="true"
        >
            {variant === 'grid'
                ? items.map((_, i) => (
                      <div className="lib-skeleton-card" key={i} aria-hidden="true">
                          <div className="lib-skeleton-box lib-skeleton-thumb" />
                          <div className="lib-skeleton-box lib-skeleton-line" />
                          <div className="lib-skeleton-box lib-skeleton-line short" />
                      </div>
                  ))
                : items.map((_, i) => (
                      <div className="lib-skeleton-row" key={i} aria-hidden="true">
                          <div className="lib-skeleton-box lib-skeleton-thumb sm" />
                          <div className="lib-skeleton-rowtext">
                              <div className="lib-skeleton-box lib-skeleton-line" />
                              <div className="lib-skeleton-box lib-skeleton-line short" />
                          </div>
                      </div>
                  ))}
        </div>
    );
};

export default Skeleton;
