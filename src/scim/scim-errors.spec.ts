import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ScimException, toScimError } from './scim-errors';

const ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';

describe('toScimError', () => {
  const env = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = env;
  });

  it('keeps a ScimException body', () => {
    expect(
      toScimError(new ScimException(400, 'invalidPath', 'bad path')),
    ).toEqual({
      schemas: [ERROR],
      status: '400',
      scimType: 'invalidPath',
      detail: 'bad path',
    });
  });

  it('maps 409 and unique violations to uniqueness', () => {
    expect(toScimError(new ConflictException('taken'))).toMatchObject({
      status: '409',
      scimType: 'uniqueness',
      detail: 'taken',
    });
    expect(toScimError({ code: 'P2002' })).toMatchObject({
      status: '409',
      scimType: 'uniqueness',
    });
  });

  it('maps other HTTP errors without a scimType', () => {
    const body = toScimError(new NotFoundException('missing'));
    expect(body).toEqual({
      schemas: [ERROR],
      status: '404',
      detail: 'missing',
    });
  });

  it('hides every 5xx detail in production', () => {
    process.env.NODE_ENV = 'production';
    expect(
      toScimError(new InternalServerErrorException('db host leaked')).detail,
    ).toBe('Internal server error');
    expect(toScimError(new Error('stack detail')).detail).toBe(
      'Internal server error',
    );
  });
});
