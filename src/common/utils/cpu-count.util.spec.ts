import {
  cpusFromCgroup,
  effectiveCpuCount,
  workerCount,
} from './cpu-count.util.js';

describe('cpu-count', () => {
  describe('cpusFromCgroup', () => {
    it('reads a cgroup v2 quota, rounding up', () => {
      expect(cpusFromCgroup('150000 100000\n', null, null)).toBe(2);
      expect(cpusFromCgroup('100000 100000', null, null)).toBe(1);
      expect(cpusFromCgroup('400000 100000', null, null)).toBe(4);
    });

    it('treats a v2 "max" as no quota', () => {
      expect(cpusFromCgroup('max 100000', null, null)).toBeNull();
    });

    it('falls back to cgroup v1, where -1 means unlimited', () => {
      expect(cpusFromCgroup(null, '50000\n', '100000\n')).toBe(1);
      expect(cpusFromCgroup(null, '-1', '100000')).toBeNull();
    });

    it('is null without any cgroup files, or with nonsense in them', () => {
      expect(cpusFromCgroup(null, null, null)).toBeNull();
      expect(cpusFromCgroup('garbage', null, null)).toBeNull();
    });
  });

  it('never reports fewer than one CPU', () => {
    expect(effectiveCpuCount()).toBeGreaterThanOrEqual(1);
  });

  describe('workerCount', () => {
    const prev = process.env['IDENPLANE_WORKERS'];
    afterEach(() => {
      if (prev === undefined) delete process.env['IDENPLANE_WORKERS'];
      else process.env['IDENPLANE_WORKERS'] = prev;
    });

    it('is 1 outside cluster mode', () => {
      delete process.env['IDENPLANE_WORKERS'];
      expect(workerCount()).toBe(1);
    });

    it('is what the primary set for its workers', () => {
      process.env['IDENPLANE_WORKERS'] = '4';
      expect(workerCount()).toBe(4);
    });

    it('ignores a value that is not a positive integer', () => {
      process.env['IDENPLANE_WORKERS'] = 'many';
      expect(workerCount()).toBe(1);
    });
  });
});
