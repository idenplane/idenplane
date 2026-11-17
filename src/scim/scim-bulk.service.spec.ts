import { NotFoundException } from '@nestjs/common';
import { ScimBulkService } from './scim-bulk.service';
import { ScimException } from './scim-errors';
import type { ScimUsersService } from './scim-users.service';
import type { ScimGroupsService } from './scim-groups.service';

const realm = { id: 'realm-1', name: 'acme' };

function setup() {
  const users = {
    create: jest.fn().mockResolvedValue({ id: 'u-new' }),
    update: jest.fn().mockResolvedValue({ id: 'u-1' }),
    patch: jest.fn().mockResolvedValue({ id: 'u-1' }),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const groups = {
    create: jest.fn().mockResolvedValue({ id: 'g-new' }),
    patch: jest.fn().mockResolvedValue({ id: 'g-1' }),
    delete: jest.fn().mockRejectedValue(new NotFoundException('no group')),
  };
  const service = new ScimBulkService(
    users as unknown as ScimUsersService,
    groups as unknown as ScimGroupsService,
  );
  return { service, users, groups };
}

describe('ScimBulkService', () => {
  it('reads "Operations" and answers with an RFC 7644 BulkResponse', async () => {
    const { service, users } = setup();
    const res = await service.processBulk(realm, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkRequest'],
      Operations: [
        { method: 'POST', path: '/Users', bulkId: 'b1', data: {} },
        {
          method: 'PATCH',
          path: '/Users/u-1',
          data: {
            Operations: [{ op: 'Replace', path: 'active', value: 'False' }],
          },
        },
      ],
    });
    expect(res.schemas).toEqual([
      'urn:ietf:params:scim:api:messages:2.0:BulkResponse',
    ]);
    expect(res.Operations).toEqual([
      {
        bulkId: 'b1',
        method: 'POST',
        status: '201',
        location: 'http://localhost:3000/scim/v2/acme/Users/u-new',
      },
      {
        method: 'PATCH',
        status: '200',
        location: 'http://localhost:3000/scim/v2/acme/Users/u-1',
      },
    ]);
    expect(users.patch).toHaveBeenCalledWith(realm, 'u-1', [
      { op: 'replace', path: 'active', value: 'False' },
    ]);
  });

  it('still reads lowercase "operations"', async () => {
    const { service, users } = setup();
    const res = await service.processBulk(realm, {
      operations: [{ method: 'DELETE', path: '/Users/u-1' }],
    });
    expect(res.Operations).toEqual([
      {
        method: 'DELETE',
        status: '204',
        location: 'http://localhost:3000/scim/v2/acme/Users/u-1',
      },
    ]);
    expect(users.delete).toHaveBeenCalledWith(realm, 'u-1');
  });

  it('reports each failure with its own status and a SCIM error', async () => {
    const { service } = setup();
    const res = await service.processBulk(realm, {
      Operations: [
        { method: 'DELETE', path: '/Groups/g-x', bulkId: 'd1' },
        { method: 'PATCH', path: '/Users', data: { Operations: [] } },
      ],
    });
    expect(res.Operations[0]).toMatchObject({
      bulkId: 'd1',
      status: '404',
      response: {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '404',
      },
    });
    // A PATCH, PUT or DELETE with no id never reaches the service.
    expect(res.Operations[1]).toMatchObject({
      status: '400',
      response: { scimType: 'invalidPath' },
    });
  });

  it('stops after failOnErrors errors', async () => {
    const { service, users } = setup();
    const res = await service.processBulk(realm, {
      failOnErrors: 1,
      Operations: [
        { method: 'DELETE', path: '/Groups/g-x' },
        { method: 'DELETE', path: '/Users/u-1' },
      ],
    });
    expect(res.Operations).toHaveLength(1);
    expect(users.delete).not.toHaveBeenCalled();
  });

  describe('bulkId references (RFC 7644 §3.7.2)', () => {
    it('resolves "bulkId:<id>" in data and in the path to the created id', async () => {
      const { service, groups } = setup();
      const res = await service.processBulk(realm, {
        Operations: [
          {
            method: 'POST',
            path: '/Users',
            bulkId: 'qwerty',
            data: { userName: 'alice' },
          },
          {
            method: 'POST',
            path: '/Groups',
            bulkId: 'ytrewq',
            data: {
              displayName: 'Tour Guides',
              members: [{ type: 'User', value: 'bulkId:qwerty' }],
            },
          },
          {
            method: 'PATCH',
            path: '/Groups/bulkId:ytrewq',
            data: {
              Operations: [
                {
                  op: 'add',
                  path: 'members',
                  value: [{ value: 'bulkId:qwerty' }],
                },
              ],
            },
          },
        ],
      });
      expect(groups.create).toHaveBeenCalledWith(realm, {
        displayName: 'Tour Guides',
        members: [{ type: 'User', value: 'u-new' }],
      });
      expect(groups.patch).toHaveBeenCalledWith(realm, 'g-new', [
        { op: 'add', path: 'members', value: [{ value: 'u-new' }] },
      ]);
      expect(res.Operations.map((o) => o.status)).toEqual([
        '201',
        '201',
        '204',
      ]);
    });

    it('runs an operation after the one it refers to, whatever their order', async () => {
      const { service, users, groups } = setup();
      const res = await service.processBulk(realm, {
        Operations: [
          {
            method: 'POST',
            path: '/Groups',
            bulkId: 'g',
            data: { displayName: 'G', members: [{ value: 'bulkId:u' }] },
          },
          { method: 'POST', path: '/Users', bulkId: 'u', data: {} },
        ],
      });
      expect(users.create.mock.invocationCallOrder[0]).toBeLessThan(
        groups.create.mock.invocationCallOrder[0],
      );
      expect(groups.create).toHaveBeenCalledWith(realm, {
        displayName: 'G',
        members: [{ value: 'u-new' }],
      });
      expect(res.Operations.map((o) => o.bulkId)).toEqual(['u', 'g']);
    });

    it('fails an unknown, failed or circular reference with 409', async () => {
      const { service, users, groups } = setup();
      users.create.mockRejectedValueOnce(
        new ScimException(409, 'uniqueness', 'taken'),
      );
      const res = await service.processBulk(realm, {
        Operations: [
          { method: 'POST', path: '/Users', bulkId: 'dup', data: {} },
          {
            method: 'PATCH',
            path: '/Users/bulkId:dup',
            data: {
              Operations: [{ op: 'replace', path: 'title', value: 'x' }],
            },
          },
          {
            method: 'POST',
            path: '/Groups',
            data: { displayName: 'X', members: [{ value: 'bulkId:nope' }] },
          },
          {
            method: 'POST',
            path: '/Groups',
            bulkId: 'a',
            data: { displayName: 'A', members: [{ value: 'bulkId:b' }] },
          },
          {
            method: 'POST',
            path: '/Groups',
            bulkId: 'b',
            data: { displayName: 'B', members: [{ value: 'bulkId:a' }] },
          },
        ],
      });
      expect(res.Operations.map((o) => o.status)).toEqual([
        '409',
        '409',
        '409',
        '409',
        '409',
      ]);
      expect(res.Operations[2].response).toMatchObject({
        scimType: 'invalidValue',
        detail: expect.stringContaining('bulkId:nope') as string,
      });
      expect(users.patch).not.toHaveBeenCalled();
      expect(groups.create).not.toHaveBeenCalled();
    });
  });

  it('refuses a request without an operations list', async () => {
    const { service } = setup();
    await expect(service.processBulk(realm, {})).rejects.toBeInstanceOf(
      ScimException,
    );
  });
});
