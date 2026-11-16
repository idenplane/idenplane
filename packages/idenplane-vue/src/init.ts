/**
 * One `init()` per IdenplaneClient, shared by the plugin, `AuthProvider`, the
 * router guard and every composable.
 *
 * Bug #438-4: every component that called useAuth() triggered its own
 * client.init(). IdenplaneClient.init() coalesces concurrent calls, but each
 * component still went through the full async path, so later-mounted
 * components flickered through a loading state. A module-level WeakMap maps
 * each client to its single init Promise and its settled result.
 */

import type { IdenplaneClient } from 'idenplane-sdk';

export interface InitRecord {
  promise: Promise<boolean>;
  settled: boolean;
  result: boolean;
}

const initRecords = new WeakMap<IdenplaneClient, InitRecord>();

/** The init record of `client`, if `init()` was started through this module. */
export function getInitRecord(client: IdenplaneClient): InitRecord | undefined {
  return initRecords.get(client);
}

/** Start `client.init()` once and return the shared Promise. */
export function getOrStartInit(client: IdenplaneClient): Promise<boolean> {
  const existing = initRecords.get(client);
  if (existing) return existing.promise;

  const record: InitRecord = {
    promise: Promise.resolve(false), // placeholder, replaced below
    settled: false,
    result: false,
  };
  record.promise = client.init().then(
    (result) => {
      record.settled = true;
      record.result = result;
      return result;
    },
    (err: unknown) => {
      // Let a later caller retry instead of caching the failure forever.
      initRecords.delete(client);
      throw err;
    },
  );
  initRecords.set(client, record);
  return record.promise;
}
