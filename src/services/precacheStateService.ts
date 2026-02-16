/**
 * Pre-cache State Service
 * Prevents individual components from fetching images during bulk pre-cache
 * to avoid rate limiting and duplicate requests
 */

class PrecacheStateService {
  private isPreCaching: boolean = false;
  private listeners: Set<() => void> = new Set();

  /**
   * Check if pre-caching is currently in progress
   */
  isPrecaching(): boolean {
    return this.isPreCaching;
  }

  /**
   * Set pre-caching state to true (bulk pre-cache started)
   */
  startPrecaching(): void {
    console.log('🚫 [PrecacheState] Blocking individual image requests - bulk pre-cache in progress');
    this.isPreCaching = true;
    this.notifyListeners();
  }

  /**
   * Set pre-caching state to false (bulk pre-cache completed)
   */
  completePrecaching(): void {
    console.log('✅ [PrecacheState] Allowing individual image requests - pre-cache complete');
    this.isPreCaching = false;
    this.notifyListeners();
  }

  /**
   * Subscribe to pre-cache state changes
   */
  subscribe(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify all listeners of state change
   */
  private notifyListeners(): void {
    this.listeners.forEach(callback => callback());
  }
}

export const precacheStateService = new PrecacheStateService();
