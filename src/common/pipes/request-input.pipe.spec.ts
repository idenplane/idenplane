import { BadRequestException } from '@nestjs/common';
import { RequestInputPipe } from './request-input.pipe.js';

describe('RequestInputPipe', () => {
  const pipe = new RequestInputPipe();
  const body = { type: 'body' as const, metatype: Object, data: undefined };

  it('turns a missing whole body into {}', () => {
    expect(pipe.transform(undefined, body)).toEqual({});
  });

  it('leaves a missing single body field alone', () => {
    expect(
      pipe.transform(undefined, { ...body, data: 'token' }),
    ).toBeUndefined();
  });

  it('passes ordinary input through unchanged', () => {
    const value = { a: 'x', n: 1, nested: [{ b: 'y' }], buf: Buffer.from([0]) };
    expect(pipe.transform(value, body)).toBe(value);
    expect(pipe.transform('abc', { type: 'param', data: 'id' })).toBe('abc');
  });

  it.each([
    ['a body value', { url: 'https://x\u0000' }, body],
    ['a nested body value', { a: [{ b: 'c\u0000' }] }, body],
    ['a body key', { ['k\u0000']: 'v' }, body],
    [
      'a query value',
      { lastName: '\u0000' },
      { type: 'query' as const, data: undefined },
    ],
    ['a path parameter', 'abc\u0000', { type: 'param' as const, data: 'id' }],
  ])('refuses a NUL character in %s', (_label, value, metadata) => {
    expect(() => pipe.transform(value, metadata)).toThrow(BadRequestException);
  });

  it('ignores custom decorators (e.g. uploaded files)', () => {
    expect(pipe.transform('a\u0000', { type: 'custom', data: undefined })).toBe(
      'a\u0000',
    );
  });
});
