import { describe, it, expect, vi } from 'vitest';

vi.mock('./logger', () => ({ logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { parseCfg, stringifyCfg } from './cfgParser';

describe('parseCfg', () => {
  it('parses a user section and its theme', () => {
    const cfg = ['[kenny]', 'theme=custom1', ''].join('\n');
    expect(parseCfg(cfg)).toEqual({ kenny: { theme: 'custom1', customThemes: {} } });
  });

  it('parses a custom-theme slot with its properties', () => {
    const cfg = [
      '[kenny]',
      'theme=custom1',
      '',
      '[kenny.custom1]',
      'name=kenny1',
      'primaryColor=#d60072',
      'isCustom=true',
    ].join('\n');
    const out = parseCfg(cfg);
    expect(out.kenny.theme).toBe('custom1');
    expect(out.kenny.customThemes.custom1).toMatchObject({
      name: 'kenny1',
      primaryColor: '#d60072',
      isCustom: 'true', // parser keeps values as strings
    });
  });

  it('ignores blank lines, comments and malformed pairs', () => {
    const cfg = ['# comment', '; also comment', '', '[bob]', 'garbageline', 'theme=cyan'].join('\n');
    expect(parseCfg(cfg)).toEqual({ bob: { theme: 'cyan', customThemes: {} } });
  });

  it('drops key=value lines that appear before any section', () => {
    expect(parseCfg('theme=cyan\n[bob]\ntheme=red')).toEqual({
      bob: { theme: 'red', customThemes: {} },
    });
  });

  it('round-trips through stringifyCfg', () => {
    const settings = {
      kenny: {
        theme: 'custom2',
        customThemes: {
          custom2: {
            name: 'n',
            primaryColor: '#111111',
            primaryLight: '#222222',
            primaryDark: '#000000',
            secondaryColor: '#333333',
            secondaryLight: '#444444',
            secondaryDark: '#111111',
            accentColor: '#555555',
            accentLight: '#666666',
            isCustom: 'true',
          },
        },
      },
    };
    const reparsed = parseCfg(stringifyCfg(settings as never));
    expect(reparsed.kenny.theme).toBe('custom2');
    expect(reparsed.kenny.customThemes.custom2).toMatchObject({
      name: 'n',
      primaryColor: '#111111',
      accentColor: '#555555',
    });
  });
});
