import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { LayoutModeProvider, useLayoutMode } from './LayoutModeContext';

function Probe() {
  const { mode, isCompact, isExpanded, isCoarsePointer } = useLayoutMode();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="compact">{String(isCompact)}</span>
      <span data-testid="expanded">{String(isExpanded)}</span>
      <span data-testid="coarse">{String(isCoarsePointer)}</span>
    </div>
  );
}

function setWidth(w: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
}

afterEach(() => setWidth(1024));

describe('LayoutModeContext', () => {
  it('reports compact below 768', () => {
    setWidth(600);
    render(<LayoutModeProvider><Probe /></LayoutModeProvider>);
    expect(screen.getByTestId('mode').textContent).toBe('compact');
    expect(screen.getByTestId('compact').textContent).toBe('true');
  });

  it('reports medium between 768 and 1199', () => {
    setWidth(900);
    render(<LayoutModeProvider><Probe /></LayoutModeProvider>);
    expect(screen.getByTestId('mode').textContent).toBe('medium');
  });

  it('reports expanded at 1200+', () => {
    setWidth(1400);
    render(<LayoutModeProvider><Probe /></LayoutModeProvider>);
    expect(screen.getByTestId('mode').textContent).toBe('expanded');
    expect(screen.getByTestId('expanded').textContent).toBe('true');
  });

  it('reacts to a window resize', () => {
    setWidth(1400);
    render(<LayoutModeProvider><Probe /></LayoutModeProvider>);
    expect(screen.getByTestId('mode').textContent).toBe('expanded');
    act(() => {
      setWidth(500);
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByTestId('mode').textContent).toBe('compact');
  });

  it('honours forceMode and ignores resize', () => {
    setWidth(1400);
    render(<LayoutModeProvider forceMode="tv"><Probe /></LayoutModeProvider>);
    expect(screen.getByTestId('mode').textContent).toBe('tv');
    act(() => {
      setWidth(500);
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByTestId('mode').textContent).toBe('tv');
  });

  it('provides a usable default with no provider', () => {
    render(<Probe />);
    expect(screen.getByTestId('mode').textContent).toBe('expanded');
  });
});
