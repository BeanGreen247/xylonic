import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useSearch } from '../../context/SearchContext';
import { search } from '../../services/subsonicApi';
import '../../styles/SearchBar.css';

const SearchBar: React.FC = () => {
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchSource, setSearchSource] = useState<'cache' | 'server' | null>(null);
  const { setSearching, setSearchQuery, setSearchResults, clearSearch, searchCached, cacheInitialized, isIndexing } = useSearch();
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      clearSearch();
      return;
    }

    setIsLoading(true);
    setSearchQuery(query);
    setSearching(true);

    try {
      // Try cached search first
      if (cacheInitialized) {
        const cachedResults = searchCached(query);
        if (cachedResults) {
          console.log('[SearchBar] Using cached search results');
          setSearchSource('cache');
          setSearchResults(cachedResults);
          setIsLoading(false);
          // Clear source indicator after 3 seconds
          setTimeout(() => setSearchSource(null), 3000);
          return;
        }
      }

      // Fall back to server search if cache unavailable
      console.log('[SearchBar] Fetching from server');
      setSearchSource('server');
      const results = await search(query);
      setSearchResults(results);
      // Clear source indicator after 3 seconds
      setTimeout(() => setSearchSource(null), 3000);
    } catch (error) {
      console.error('Search failed:', error);
      setSearchResults(null);
    } finally {
      setIsLoading(false);
    }
  }, [setSearching, setSearchQuery, setSearchResults, clearSearch, searchCached, cacheInitialized]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    
    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    // Set new timeout for 2.5 seconds (between 2-3 seconds as requested)
    searchTimeoutRef.current = setTimeout(() => {
      handleSearch(value);
    }, 2500);
  };

  const handleClear = () => {
    setInputValue('');
    setSearchSource(null);
    clearSearch();
  };

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
    if (!isExpanded) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      handleClear();
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (inputRef.current && !inputRef.current.contains(event.target as Node)) {
        const searchContainer = document.querySelector('.search-bar');
        if (searchContainer && !searchContainer.contains(event.target as Node)) {
          if (!inputValue) {
            setIsExpanded(false);
          }
        }
      }
    };

    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isExpanded, inputValue]);

  return (
    <div className={`search-bar ${isExpanded ? 'expanded' : ''}`}>
      {!isExpanded ? (
        <button onClick={toggleExpanded} className="search-toggle-btn" aria-label="Search">
          <i className="fas fa-search"></i> Search
        </button>
      ) : (
        <>
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            placeholder={isIndexing ? "Building search index..." : "Search artists, albums, songs..."}
            className="search-input"
            disabled={isIndexing}
          />
          {isLoading && <span className="search-loading">Loading...</span>}
          {isIndexing && <span className="search-loading" title="Building search index">Indexing...</span>}
          {searchSource === 'cache' && <span className="search-status" title="Loaded from cache">Cache</span>}
          {searchSource === 'server' && <span className="search-status" title="Loaded from server">Server</span>}
          {inputValue && !isIndexing && (
            <button onClick={handleClear} className="search-clear" aria-label="Clear search">
              <i className="fas fa-times"></i> Clear
            </button>
          )}
        </>
      )}
    </div>
  );
};

export default SearchBar;
