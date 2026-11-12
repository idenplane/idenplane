import { Client } from 'ldapts';
import { LdapClientWrapper } from './ldap.client.js';

jest.mock('ldapts', () => ({ Client: jest.fn() }));
const ClientMock = Client as unknown as jest.Mock;
const config = { connectionUrl: 'ldap://directory.internal:389', bindDn: 'cn=service', bindCredential: 'service-test-secret', startTls: true, connectionTimeout: 1000 };
const search = { usersDn: 'dc=example', userObjectClass: 'person', usernameLdapAttr: 'uid', uuidLdapAttr: 'entryUUID' };
const makeClient = () => ({ startTLS: jest.fn().mockResolvedValue(undefined), bind: jest.fn().mockResolvedValue(undefined), unbind: jest.fn().mockResolvedValue(undefined), search: jest.fn().mockResolvedValue({searchEntries: [{dn: 'uid=alice,dc=example', uid: 'alice', entryUUID: 'user-1'}]}) });
const wrapper = (overrides = {}) => new LdapClientWrapper({...config, ...overrides}, search);

describe('LDAP verified transport and connection cleanup', () => {
  beforeEach(() => ClientMock.mockReset());

  it('upgrades ldap:// with verified StartTLS before binding', async () => {
    const client = makeClient(); ClientMock.mockReturnValue(client);
    expect(await wrapper().testConnection()).toEqual({success: true});
    expect(client.startTLS).toHaveBeenCalledWith({rejectUnauthorized: true, host:'directory.internal', servername:'directory.internal'});
    expect(client.startTLS.mock.invocationCallOrder[0]).toBeLessThan(client.bind.mock.invocationCallOrder[0]);
    expect(ClientMock.mock.calls[0][0].tlsOptions).toBeUndefined();
    expect(client.unbind).toHaveBeenCalledTimes(1);
  });

  it('verifies implicit LDAPS and does not attempt a second TLS upgrade', async () => {
    const client = makeClient(); ClientMock.mockReturnValue(client);
    expect(await wrapper({connectionUrl: 'ldaps://directory.internal:636'}).testConnection()).toEqual({success: true});
    expect(ClientMock.mock.calls[0][0].tlsOptions).toEqual({rejectUnauthorized: true});
    expect(client.startTLS).not.toHaveBeenCalled();
  });

  it('uses an IPv6 address for identity checks without sending it as an SNI hostname', async () => {
    const client=makeClient();ClientMock.mockReturnValue(client);
    expect((await wrapper({connectionUrl:'ldap://[::1]:389'}).testConnection()).success).toBe(true);
    expect(client.startTLS).toHaveBeenCalledWith({rejectUnauthorized:true,host:'::1',servername:undefined});
  });

  it('never sends bind credentials when StartTLS fails and closes the connection', async () => {
    const client = makeClient(); client.startTLS.mockRejectedValue(new Error('untrusted certificate')); ClientMock.mockReturnValue(client);
    expect(await wrapper().testConnection()).toEqual({success: false, error: 'untrusted certificate'});
    expect(client.bind).not.toHaveBeenCalled(); expect(client.unbind).toHaveBeenCalledTimes(1);
  });

  it('closes a connection after a bind failure', async () => {
    const client = makeClient(); client.bind.mockRejectedValue(new Error('invalid credentials')); ClientMock.mockReturnValue(client);
    expect((await wrapper().testConnection()).success).toBe(false); expect(client.unbind).toHaveBeenCalledTimes(1);
  });

  it('secures and closes both service and user connections during authentication', async () => {
    const service = makeClient(), user = makeClient(); ClientMock.mockReturnValueOnce(service).mockReturnValueOnce(user);
    expect(await wrapper().authenticate('alice', 'user-test-secret')).toBe(true);
    for(const client of [service, user]){
      expect(client.startTLS).toHaveBeenCalledWith({rejectUnauthorized: true, host:'directory.internal', servername:'directory.internal'});
      expect(client.startTLS.mock.invocationCallOrder[0]).toBeLessThan(client.bind.mock.invocationCallOrder[0]);
      expect(client.unbind).toHaveBeenCalledTimes(1);
    }
    expect(user.bind).toHaveBeenCalledWith('uid=alice,dc=example', 'user-test-secret');
  });

  it('closes the user connection when its bind fails', async () => {
    const service = makeClient(), user = makeClient(); user.bind.mockRejectedValue(new Error('wrong password')); ClientMock.mockReturnValueOnce(service).mockReturnValueOnce(user);
    expect(await wrapper().authenticate('alice', 'wrong-password')).toBe(false);
    expect(service.unbind).toHaveBeenCalledTimes(1); expect(user.unbind).toHaveBeenCalledTimes(1);
  });

  it.each(['searchUser', 'searchAllUsers'] as const)('closes %s after a search failure', async method => {
    const client = makeClient(); client.search.mockRejectedValue(new Error('search failed')); ClientMock.mockReturnValue(client);
    const service = wrapper();
    const result = method === 'searchUser' ? await service.searchUser('alice') : await service.searchAllUsers();
    expect(result).toEqual(method === 'searchUser' ? null : []); expect(client.unbind).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty password without attempting an anonymous bind', async () => {
    const client=makeClient(); ClientMock.mockReturnValue(client);
    expect(await wrapper().authenticate('alice', '')).toBe(false); expect(ClientMock).not.toHaveBeenCalled();
  });

  it('does not hide a TLS failure if closing the connection also fails', async () => {
    const client=makeClient(); client.startTLS.mockRejectedValue(new Error('untrusted certificate')); client.unbind.mockRejectedValue(new Error('already closed')); ClientMock.mockReturnValue(client);
    expect(await wrapper().testConnection()).toEqual({success: false, error: 'untrusted certificate'});
  });

  it('preserves LDAP filter escaping and mapped search results', async () => {
    const client=makeClient(); ClientMock.mockReturnValue(client);
    expect(await wrapper().searchUser('alice*')).toMatchObject({dn:'uid=alice,dc=example', uid:'alice', uuid:'user-1'});
    expect(client.search.mock.calls[0][1].filter).toContain('alice\\2a');
  });

  it('rejects an unsupported connection URL before creating a client', async () => {
    const client=makeClient();ClientMock.mockReturnValue(client);
    expect((await wrapper({connectionUrl:'http://directory.internal'}).testConnection()).success).toBe(false);
    expect(ClientMock).not.toHaveBeenCalled();
  });
});
