/**
 * The SCIM User attributes Idenplane keeps beyond its own user columns.
 *
 * `users.scim_profile` holds them as JSON, in the shape SCIM returns them:
 * displayName, title and the other singular strings, the name parts with no
 * column, phoneNumbers, addresses and the enterprise extension. Only SCIM
 * writes them and nothing else reads them: in particular `phoneNumbers` is
 * never the user's SMS MFA number (`users.phone_number`).
 */

import { SCIM_SCHEMAS } from './types/scim.types.js';

/** One value of a multi-valued attribute (`phoneNumbers`, `addresses`). */
export type ScimMultiValue = Record<string, string | boolean>;

export interface ScimEnterpriseProfile {
  employeeNumber?: string;
  costCenter?: string;
  organization?: string;
  division?: string;
  department?: string;
  /** The manager's id (`manager.value`). */
  manager?: string;
}

export interface ScimProfile {
  displayName?: string;
  nickName?: string;
  profileUrl?: string;
  title?: string;
  userType?: string;
  preferredLanguage?: string;
  locale?: string;
  timezone?: string;
  /** The `name` parts with no column (`givenName`/`familyName` have one). */
  name?: {
    formatted?: string;
    middleName?: string;
    honorificPrefix?: string;
    honorificSuffix?: string;
  };
  phoneNumbers?: ScimMultiValue[];
  addresses?: ScimMultiValue[];
  enterprise?: ScimEnterpriseProfile;
}

/** Singular core string attributes kept in the profile, by lowercased name. */
export const PROFILE_STRINGS: Record<
  string,
  Exclude<
    keyof ScimProfile,
    'name' | 'phoneNumbers' | 'addresses' | 'enterprise'
  >
> = {
  displayname: 'displayName',
  nickname: 'nickName',
  profileurl: 'profileUrl',
  title: 'title',
  usertype: 'userType',
  preferredlanguage: 'preferredLanguage',
  locale: 'locale',
  timezone: 'timezone',
};

/** `name` sub-attributes kept in the profile, by lowercased name. */
export const PROFILE_NAME_PARTS: Record<
  string,
  keyof NonNullable<ScimProfile['name']>
> = {
  formatted: 'formatted',
  middlename: 'middleName',
  honorificprefix: 'honorificPrefix',
  honorificsuffix: 'honorificSuffix',
};

/** Enterprise extension strings, by lowercased name (`manager` aside). */
export const ENTERPRISE_STRINGS: Record<
  string,
  Exclude<keyof ScimEnterpriseProfile, 'manager'>
> = {
  employeenumber: 'employeeNumber',
  costcenter: 'costCenter',
  organization: 'organization',
  division: 'division',
  department: 'department',
};

export interface MultiValuedSpec {
  key: 'phoneNumbers' | 'addresses';
  /** Sub-attributes kept, lowercased name → SCIM name. */
  subs: Record<string, string>;
}

/** Multi-valued attributes kept in the profile, by lowercased name. */
export const MULTI_VALUED: Record<string, MultiValuedSpec> = {
  phonenumbers: {
    key: 'phoneNumbers',
    subs: {
      value: 'value',
      type: 'type',
      primary: 'primary',
      display: 'display',
    },
  },
  addresses: {
    key: 'addresses',
    subs: {
      formatted: 'formatted',
      streetaddress: 'streetAddress',
      locality: 'locality',
      region: 'region',
      postalcode: 'postalCode',
      country: 'country',
      type: 'type',
      primary: 'primary',
    },
  },
};

/** Longest string kept in the profile. */
export const MAX_PROFILE_TEXT = 2048;
/** Most values kept for one multi-valued attribute. */
export const MAX_MULTI_VALUES = 20;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The profile stored on a user row; anything malformed reads as empty. */
export function readProfile(json: unknown): ScimProfile {
  return isPlainObject(json) ? structuredClone(json) : {};
}

/**
 * The profile with empty parts removed, ready to store; `null` when empty
 * (so the column stays NULL for users SCIM never described).
 */
export function compactProfile(profile: ScimProfile): ScimProfile | null {
  const out: ScimProfile = { ...profile };
  for (const key of ['name', 'enterprise'] as const) {
    const part = out[key];
    if (part && Object.keys(part).length === 0) delete out[key];
  }
  for (const key of ['phoneNumbers', 'addresses'] as const) {
    if (out[key]?.length === 0) delete out[key];
  }
  return Object.keys(out).length === 0 ? null : out;
}

/** The enterprise extension as SCIM returns it, or undefined when empty. */
export function enterpriseToScim(
  enterprise: ScimEnterpriseProfile | undefined,
): Record<string, unknown> | undefined {
  if (!enterprise || Object.keys(enterprise).length === 0) return undefined;
  const { manager, ...strings } = enterprise;
  return {
    ...strings,
    ...(manager ? { manager: { value: manager } } : {}),
  };
}

export const ENTERPRISE_USER_SCHEMA_URN = SCIM_SCHEMAS.ENTERPRISE_USER;
