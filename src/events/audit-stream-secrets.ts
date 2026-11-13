import { BadRequestException } from '@nestjs/common';
import type { CryptoService } from '../crypto/crypto.service.js';
import {
  openSecretJson,
  redactSecretJson,
  sealSecretJson,
  type SecretJsonShape,
} from '../crypto/stored-secrets.js';

/**
 * AuditLogStream.httpHeaders: header name → value. Every value is treated as
 * a secret (an Authorization or API-key header is the usual reason to set
 * one), so values are encrypted at rest and shown as the placeholder; header
 * names stay readable. Decrypted only to deliver to the stream.
 */
export const STREAM_HEADERS_SHAPE: SecretJsonShape = { allSecret: true };

export const auditStreamSecrets = {
  /**
   * The headers to store from what the client sent. The object replaces the
   * stored one; a value sent back as the placeholder keeps the stored value
   * of the same header. undefined (not sent) leaves the column alone.
   */
  forWrite(
    crypto: CryptoService,
    incoming: Record<string, string> | undefined,
    stored?: unknown,
  ): Record<string, string> | undefined {
    if (incoming === undefined) return undefined;
    // Only strings are encrypted, so anything else would be stored in clear.
    for (const [name, value] of Object.entries(incoming)) {
      if (typeof value !== 'string') {
        throw new BadRequestException(`httpHeaders.${name} must be a string`);
      }
    }
    return sealSecretJson(
      crypto,
      incoming,
      STREAM_HEADERS_SHAPE,
      stored,
    ) as Record<string, string>;
  },

  /** A stream row as the admin API returns it. */
  redact<T extends { httpHeaders?: unknown }>(stream: T): T {
    if (stream.httpHeaders === undefined || stream.httpHeaders === null) {
      return stream;
    }
    return {
      ...stream,
      httpHeaders: redactSecretJson(stream.httpHeaders, STREAM_HEADERS_SHAPE),
    };
  },

  /** The plaintext headers, for delivery. Anything but an object is none. */
  headers(
    crypto: CryptoService,
    stream: { httpHeaders: unknown },
  ): Record<string, string> {
    const stored = stream.httpHeaders;
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      return {};
    }
    const out: Record<string, string> = {};
    const opened = openSecretJson(
      crypto,
      stored,
      STREAM_HEADERS_SHAPE,
    ) as Record<string, unknown>;
    for (const [name, value] of Object.entries(opened)) {
      if (typeof value === 'string') out[name] = value;
    }
    return out;
  },
};
