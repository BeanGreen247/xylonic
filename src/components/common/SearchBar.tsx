import React, { useRef, useEffect } from 'react';
import { useSearch } from '../../context/SearchContext';
import '../../styles/SearchBar.css';

const SearchBar: React.FC = () => {
  const { inputValue, handleInputChange, isLoading, isIndexing, clearSearch } = useSearch();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Legacy mobile-focus-search event (still supported)
  useEffect(() => {
    const onFocus = () => inputRef.current?.focus();
    window.addEventListener('mobile-focus-search', onFocus);
    return () => window.removeEventListener('mobile-focus-search', onFocus);
  }, []);

  const handleClear = () => {
    clearSearch();
    inputRef.current?.focus();
  };

  return (
    <div className="search-bar">
      <i className="fas fa-search search-bar-icon" aria-hidden="true"></i>
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={e => handleInputChange(e.target.value)}
        placeholder={isIndexing ? 'Indexing…' : 'Search  ⌃K'}
        className="search-input"
        disabled={isIndexing}
        aria-label="Search artists, albums, songs"
      />
      {isLoading && (
        <span className="search-bar-spinner" aria-label="Searching">
          <i className="fas fa-circle-notch fa-spin"></i>
        </span>
      )}
      {inputValue && !isLoading && (
        <button onClick={handleClear} className="search-clear" aria-label="Clear search">
          <i className="fas fa-times"></i>
        </button>
      )}
    </div>
  );
};

export default SearchBar;
