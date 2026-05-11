import { Injectable, Logger } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { SmsProvider } from './sms-provider.interface.js';

@Injectable()
export class AwsSnsProvider implements SmsProvider {
  readonly name = 'aws-sns';
  private readonly logger = new Logger(AwsSnsProvider.name);
  private accessKeyId: string | null = null;
  private secretAccessKey: string | null = null;
  private region: string | null = null;
  private fromNumber: string | null = null;
  private readonly xmlParser = new XMLParser();

  constructor() {
    this.initializeClient();
  }

  private initializeClient(): void {
    this.accessKeyId = process.env['AWS_ACCESS_KEY_ID'] ?? null;
    this.secretAccessKey = process.env['AWS_SECRET_ACCESS_KEY'] ?? null;
    this.region = process.env['AWS_REGION'] ?? null;
    this.fromNumber = process.env['AWS_SNS_FROM_NUMBER'] ?? null;

    if (this.accessKeyId && this.secretAccessKey && this.region) {
      this.logger.log('AWS SNS SMS provider initialized');
    } else {
      this.logger.warn(
        'AWS credentials not configured - set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION',
      );
    }
  }

  private getSigningKey(date: string, region: string, service: string): string {
    const kDate = this.hmacSha256('AWS4' + this.secretAccessKey!, date, 'utf8');
    const kRegion = this.hmacSha256(kDate, region, 'utf8');
    const kService = this.hmacSha256(kRegion, service, 'utf8');
    const kSigning = this.hmacSha256(kService, 'aws4_request', 'utf8');
    return kSigning;
  }

  private hmacSha256(key: string, data: string, encoding: 'utf8' | 'hex'): Buffer {
    const crypto = require('crypto') as typeof import('crypto');
    return crypto.createHmac('sha256', key).update(data, encoding).digest();
  }

  private sha256(data: string): string {
    const crypto = require('crypto') as typeof import('crypto');
    return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
  }

  private getSignatureKey(
    date: string,
    region: string,
    service: string,
  ): Buffer {
    return this.getSigningKey(date, region, service);
  }

  private async signRequest(
    action: string,
    phoneNumber: string,
    message: string,
  ): Promise<string> {
    const date = new Date();
    const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = date.toISOString().split('T')[0];

    const host = `sns.${this.region}.amazonaws.com`;
    const endpoint = `https://${host}/`;

    const payloadHash = this.sha256(`Action=${action}&Message=${encodeURIComponent(message)}&PhoneNumber=${encodeURIComponent(phoneNumber)}&Version=2010-03-31`);

    const headers = {
      'host': host,
      'x-amz-date': amzDate,
      'x-amz-target': `AmazonSNSv20100331.${action}`,
    };

    const sortedHeaders = Object.keys(headers).sort();
    const canonicalHeaders = sortedHeaders.map(k => `${k}:${headers[k as keyof typeof headers]}`).join('\n') + '\n';
    const signedHeaders = sortedHeaders.join(';');

    const canonicalRequest = [
      'POST',
      '/',
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${this.region}/sns/aws4_request`;
    const stringToSign = [
      algorithm,
      amzDate,
      credentialScope,
      this.sha256(canonicalRequest),
    ].join('\n');

    const signingKey = this.getSignatureKey(dateStamp, this.region!, 'sns');
    const crypto = require('crypto') as typeof import('crypto');
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

    const authHeader = `${algorithm} Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return authHeader;
  }

  async sendSms(to: string, message: string): Promise<void> {
    if (!this.accessKeyId || !this.secretAccessKey || !this.region) {
      throw new Error('AWS SNS client not initialized');
    }

    if (!this.fromNumber) {
      throw new Error('AWS SNS from number not configured - set AWS_SNS_FROM_NUMBER');
    }

    try {
      const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
      const dateStamp = new Date().toISOString().split('T')[0];
      const host = `sns.${this.region}.amazonaws.com`;

      const params = new URLSearchParams();
      params.append('Action', 'Publish');
      params.append('Message', message);
      params.append('PhoneNumber', to);
      params.append('MessageStructure', 'string');
      params.append('Version', '2010-03-31');

      const body = params.toString();

      const payloadHash = require('crypto')
        .createHash('sha256')
        .update(body, 'utf8')
        .digest('hex');

      const headers: Record<string, string> = {
        'content-type': 'application/x-www-form-urlencoded',
        'host': host,
        'x-amz-date': amzDate,
        'x-amz-target': 'AmazonSNSv20100331.Publish',
      };

      const sortedHeaderKeys = Object.keys(headers).sort();
      const canonicalHeaders = sortedHeaderKeys
        .map(k => `${k}:${headers[k]}`)
        .join('\n') + '\n';
      const signedHeaders = sortedHeaderKeys.join(';');

      const canonicalRequest = [
        'POST',
        '/',
        '',
        canonicalHeaders,
        signedHeaders,
        payloadHash,
      ].join('\n');

      const algorithm = 'AWS4-HMAC-SHA256';
      const credentialScope = `${dateStamp}/${this.region}/sns/aws4_request`;
      const stringToSign = [
        algorithm,
        amzDate,
        credentialScope,
        this.sha256(canonicalRequest),
      ].join('\n');

      const signingKey = this.getSignatureKey(dateStamp, this.region, 'sns');
      const crypto = require('crypto') as typeof import('crypto');
      const signature = crypto.createHmac('sha256', signingKey)
        .update(stringToSign, 'utf8')
        .digest('hex');

      headers['authorization'] = `${algorithm} Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

      const response = await fetch(`https://${host}/`, {
        method: 'POST',
        headers,
        body,
      });

      if (!response.ok) {
        const responseText = await response.text();
        const parsed = this.xmlParser.parse(responseText) as {
          ErrorResponse?: {
            Error?: {
              Code?: string;
              Message?: string;
            };
          };
        };
        const errorMessage = parsed?.ErrorResponse?.Error?.Message ?? responseText;
        throw new Error(`AWS SNS API error: ${response.status} - ${errorMessage}`);
      }

      const resultText = await response.text();
      const result = this.xmlParser.parse(resultText) as {
        PublishResponse?: {
          PublishResult?: {
            MessageId?: string;
          };
          ResponseMetadata?: {
            RequestId?: string;
          };
        };
      };

      if (result?.PublishResponse?.PublishResult?.MessageId) {
        this.logger.log(`SMS sent to ${to}, MessageId: ${result.PublishResponse.PublishResult.MessageId}`);
      } else {
        this.logger.log(`SMS sent to ${to}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('AWS SNS')) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to send SMS to ${to}: ${errorMessage}`);
      throw new Error(`AWS SNS SMS failed: ${errorMessage}`);
    }
  }

  isConfigured(): boolean {
    return (
      this.accessKeyId !== null &&
      this.secretAccessKey !== null &&
      this.region !== null &&
      this.fromNumber !== null
    );
  }
}