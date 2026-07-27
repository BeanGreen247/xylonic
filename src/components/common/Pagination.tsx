import React from 'react';

interface PaginationProps {
  currentPage: number;
  /** Known total page count. Pass 0 when total is unknown (online/cursor mode). */
  totalPages: number;
  /** Only used when totalPages === 0: disables the Next button when false. */
  hasMore?: boolean;
  onPageChange: (page: number) => void;
}

const Pagination: React.FC<PaginationProps> = ({ currentPage, totalPages, hasMore, onPageChange }) => {
  if (totalPages === 1) return null;

  const isOnlineMode = totalPages === 0;

  const pageNums = isOnlineMode ? [] : Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
    if (totalPages <= 7) return i + 1;
    if (currentPage <= 4) return i + 1;
    if (currentPage >= totalPages - 3) return totalPages - 6 + i;
    if (i === 0) return 1;
    if (i === 1) return currentPage - 1;
    if (i === 2) return currentPage;
    if (i === 3) return currentPage + 1;
    return totalPages;
  });

  return (
    <div className="pagination-controls">
      <button
        className="pagination-button"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        title="Previous page"
      >
        <i className="fas fa-chevron-left" /> Previous
      </button>

      {isOnlineMode ? (
        <button className="pagination-page active" style={{ pointerEvents: 'none' }}>
          {currentPage}
        </button>
      ) : (
        <>
          <div className="pagination-pages">
            {pageNums.map(pageNum => (
              <button
                key={pageNum}
                className={`pagination-page ${currentPage === pageNum ? 'active' : ''}`}
                onClick={() => onPageChange(pageNum)}
              >
                {pageNum}
              </button>
            ))}
          </div>
          <button
            className="pagination-page active mobile-page-indicator"
            style={{ pointerEvents: 'none' }}
          >
            {currentPage}
          </button>
        </>
      )}

      <button
        className="pagination-button"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={isOnlineMode ? !hasMore : currentPage === totalPages}
        title="Next page"
      >
        Next <i className="fas fa-chevron-right" />
      </button>
    </div>
  );
};

export default Pagination;
