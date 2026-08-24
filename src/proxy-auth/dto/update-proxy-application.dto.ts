import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateProxyApplicationDto } from './create-proxy-application.dto.js';

/**
 * Everything except `slug` is updatable.
 *
 * The slug is part of the URL the proxy is configured with, so renaming it
 * server-side would silently break a working deployment — the proxy would keep
 * calling a path that no longer exists, and every request to the protected
 * application would 404 instead of authenticating. Delete and recreate is the
 * honest way to change it.
 */
export class UpdateProxyApplicationDto extends PartialType(
  OmitType(CreateProxyApplicationDto, ['slug'] as const),
) {}
