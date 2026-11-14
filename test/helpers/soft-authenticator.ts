import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from 'crypto';

/**
 * A software passkey for the e2e suite: a P-256 key pair and hand-built
 * WebAuthn registration and assertion responses, just enough for
 * `@simplewebauthn/server` to verify them ("none" attestation, ES256).
 */

/** A minimal CBOR encoder: maps, integers, byte and text strings. */
type Cbor = number | string | Uint8Array | Map<number | string, Cbor>;

function cborHead(major: number, length: number): Buffer {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 0x100) return Buffer.from([(major << 5) | 24, length]);
  if (length < 0x10000) {
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(length, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(length, 1);
  return b;
}

function cbor(value: Cbor): Buffer {
  if (typeof value === 'number') {
    return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  }
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([cborHead(3, bytes.length), bytes]);
  }
  if (value instanceof Uint8Array) {
    return Buffer.concat([cborHead(2, value.length), Buffer.from(value)]);
  }
  const parts: Buffer[] = [cborHead(5, value.size)];
  for (const [k, v] of value) parts.push(cbor(k), cbor(v));
  return Buffer.concat(parts);
}

const sha256 = (data: Buffer | string) =>
  createHash('sha256').update(data).digest();
const b64url = (data: Buffer) => data.toString('base64url');

/** User present, user verified, attested credential data included. */
const FLAGS_UP = 0x01;
const FLAGS_UV = 0x04;
const FLAGS_AT = 0x40;

export interface CreationOptions {
  challenge: string;
  rp: { id?: string };
  user: { id: string };
}

export interface RequestOptions {
  challenge: string;
  rpId?: string;
}

export class SoftAuthenticator {
  readonly credentialId = randomBytes(16);
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private userHandle?: string;
  /** Strictly increasing, as the server refuses a counter that does not grow. */
  private signCount = 0;

  constructor(
    /** The relying-party id, `realm.webAuthnRpId` (`localhost` by default). */
    readonly rpId: string,
    /** The origin the server expects for that rp id. */
    readonly origin: string,
  ) {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
  }

  get id(): string {
    return b64url(this.credentialId);
  }

  /** The COSE_Key of the public key (EC2, ES256, P-256). */
  cosePublicKey(): Buffer {
    const jwk = this.publicKey.export({ format: 'jwk' });
    return cbor(
      new Map<number, Cbor>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x as string, 'base64url')],
        [-3, Buffer.from(jwk.y as string, 'base64url')],
      ]),
    );
  }

  private authenticatorData(flags: number, attested?: Buffer): Buffer {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.signCount, 0);
    return Buffer.concat([
      sha256(this.rpId),
      Buffer.from([flags]),
      count,
      ...(attested ? [attested] : []),
    ]);
  }

  private clientData(type: string, challenge: string): Buffer {
    return Buffer.from(
      JSON.stringify({
        type,
        challenge,
        origin: this.origin,
        crossOrigin: false,
      }),
    );
  }

  /** A `RegistrationResponseJSON` for `navigator.credentials.create()`. */
  register(options: CreationOptions) {
    this.userHandle = options.user.id;
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length, 0);
    const attested = Buffer.concat([
      Buffer.alloc(16), // AAGUID: none
      idLength,
      this.credentialId,
      this.cosePublicKey(),
    ]);
    const authData = this.authenticatorData(
      FLAGS_UP | FLAGS_UV | FLAGS_AT,
      attested,
    );
    const attestationObject = cbor(
      new Map<string, Cbor>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: b64url(
          this.clientData('webauthn.create', options.challenge),
        ),
        attestationObject: b64url(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  /** An `AuthenticationResponseJSON` for `navigator.credentials.get()`. */
  assert(options: RequestOptions) {
    this.signCount += 1;
    const authData = this.authenticatorData(FLAGS_UP | FLAGS_UV);
    const clientDataJSON = this.clientData('webauthn.get', options.challenge);
    const signature = sign(
      'sha256',
      Buffer.concat([authData, sha256(clientDataJSON)]),
      this.privateKey, // DER-encoded ECDSA, as authenticators produce
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        ...(this.userHandle ? { userHandle: this.userHandle } : {}),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }
}

/** The origin `WebAuthnService` expects for an rp id, from `BASE_URL`. */
export function expectedOrigin(rpId: string): string {
  const baseUrl = process.env['BASE_URL'] ?? 'http://localhost:3000';
  try {
    const url = new URL(baseUrl);
    const port =
      url.port && url.port !== '80' && url.port !== '443' ? `:${url.port}` : '';
    return `${url.protocol}//${rpId}${port}`;
  } catch {
    return `https://${rpId}`;
  }
}
