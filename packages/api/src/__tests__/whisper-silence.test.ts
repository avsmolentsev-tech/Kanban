import { buildSilenceFilter } from '../services/whisper-local.service';

describe('обрезка тишины перед whisper', () => {
  test('фильтр вырезает тишину с обоих концов и длинные паузы внутри', () => {
    const f = buildSilenceFilter();
    expect(f).toContain('silenceremove');
    expect(f).toContain('start_periods=1');
    expect(f).toContain('stop_periods=-1');
    expect(f).toMatch(/-40dB|-45dB|-50dB/);
  });

  test('фильтр не схлопывает короткие естественные паузы', () => {
    const f = buildSilenceFilter();
    const dur = f.match(/stop_duration=([\d.]+)/);
    expect(dur).not.toBeNull();
    expect(parseFloat(dur![1])).toBeGreaterThanOrEqual(1);
  });
});
