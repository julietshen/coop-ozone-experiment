/**
 * HTTP client for the Ozone moderation service XRPC API.
 *
 * Handles DID-based service authentication (JWT signing) and wraps
 * the key Ozone endpoints: queryEvents, emitEvent, queryStatuses.
 */
import * as jose from 'jose';

import { jsonStringify } from '../../utils/encoding.js';
import { type FetchHTTP } from '../networkingService/index.js';
import type {
  OzoneEmitEventInput,
  OzoneEmitEventResponse,
  OzoneModerationEvent,
  OzoneQueryEventsParams,
  OzoneQueryEventsResponse,
  OzoneQueryStatusesParams,
  OzoneQueryStatusesResponse,
} from './types.js';

export type OzoneClientConfig = {
  serviceUrl: string;
  did: string;
  signingKey: string;
};

const OZONE_REQUEST_TIMEOUT_MS = 10_000;

export class OzoneApiClient {
  constructor(
    private readonly fetchHTTP: FetchHTTP,
    private readonly config: OzoneClientConfig,
  ) {}

  /**
   * Query moderation events from Ozone (inbound polling).
   * See: tools.ozone.moderation.queryEvents
   */
  async queryEvents(
    params: OzoneQueryEventsParams,
  ): Promise<OzoneQueryEventsResponse> {
    const url = new URL(
      '/xrpc/tools.ozone.moderation.queryEvents',
      this.config.serviceUrl,
    );
    if (params.cursor) url.searchParams.set('cursor', params.cursor);
    if (params.limit) url.searchParams.set('limit', String(params.limit));
    if (params.types) {
      for (const type of params.types) {
        url.searchParams.append('types', type);
      }
    }
    if (params.subject) url.searchParams.set('subject', params.subject);
    if (params.sortDirection)
      url.searchParams.set('sortDirection', params.sortDirection);
    if (params.createdAfter)
      url.searchParams.set('createdAfter', params.createdAfter);
    if (params.createdBefore)
      url.searchParams.set('createdBefore', params.createdBefore);

    const token = await this.createServiceAuthToken();
    const response = await this.fetchHTTP({
      url: url.toString(),
      method: 'get',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      handleResponseBody: 'as-json',
      timeoutMs: OZONE_REQUEST_TIMEOUT_MS,
    });

    if (!response.ok) {
      throw new Error(
        `Ozone queryEvents failed with status ${response.status}`,
      );
    }

    return response.body as OzoneQueryEventsResponse;
  }

  /**
   * Emit a moderation event to Ozone (outbound action).
   * See: tools.ozone.moderation.emitEvent
   */
  async emitEvent(
    input: OzoneEmitEventInput,
  ): Promise<OzoneEmitEventResponse> {
    const url = new URL(
      '/xrpc/tools.ozone.moderation.emitEvent',
      this.config.serviceUrl,
    );

    const token = await this.createServiceAuthToken();
    const response = await this.fetchHTTP({
      url: url.toString(),
      method: 'post',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: jsonStringify(input),
      handleResponseBody: 'as-json',
      timeoutMs: OZONE_REQUEST_TIMEOUT_MS,
    });

    if (!response.ok) {
      throw new Error(
        `Ozone emitEvent failed with status ${response.status}`,
      );
    }

    return response.body as OzoneEmitEventResponse;
  }

  /**
   * Query moderation statuses from Ozone.
   * See: tools.ozone.moderation.queryStatuses
   */
  async queryStatuses(
    params: OzoneQueryStatusesParams,
  ): Promise<OzoneQueryStatusesResponse> {
    const url = new URL(
      '/xrpc/tools.ozone.moderation.queryStatuses',
      this.config.serviceUrl,
    );
    if (params.cursor) url.searchParams.set('cursor', params.cursor);
    if (params.limit) url.searchParams.set('limit', String(params.limit));
    if (params.subject) url.searchParams.set('subject', params.subject);
    if (params.reviewState)
      url.searchParams.set('reviewState', params.reviewState);

    const token = await this.createServiceAuthToken();
    const response = await this.fetchHTTP({
      url: url.toString(),
      method: 'get',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      handleResponseBody: 'as-json',
      timeoutMs: OZONE_REQUEST_TIMEOUT_MS,
    });

    if (!response.ok) {
      throw new Error(
        `Ozone queryStatuses failed with status ${response.status}`,
      );
    }

    return response.body as OzoneQueryStatusesResponse;
  }

  /**
   * Check Ozone service health.
   */
  async healthCheck(): Promise<{ version: string }> {
    const url = new URL('/xrpc/_health', this.config.serviceUrl);
    const response = await this.fetchHTTP({
      url: url.toString(),
      method: 'get',
      handleResponseBody: 'as-json',
      timeoutMs: 5_000,
    });

    if (!response.ok) {
      throw new Error(`Ozone health check failed with status ${response.status}`);
    }

    return response.body as { version: string };
  }

  /**
   * Create a signed JWT for DID-based service authentication.
   * The token identifies this service (via its DID) to Ozone.
   */
  private async createServiceAuthToken(): Promise<string> {
    const { did, signingKey } = this.config;

    // Import the private key (expects hex-encoded secp256k1 key, as per Ozone HOSTING.md)
    const keyBytes = hexToUint8Array(signingKey);
    const privateKey = await jose.importPKCS8(
      rawSecp256k1ToPKCS8Pem(keyBytes),
      'ES256K',
    );

    const now = Math.floor(Date.now() / 1000);
    const token = await new jose.SignJWT({
      iss: did,
      aud: `did:web:${new URL(this.config.serviceUrl).hostname}`,
      exp: now + 60, // 1 minute expiry
      iat: now,
    })
      .setProtectedHeader({ alg: 'ES256K', typ: 'JWT' })
      .sign(privateKey);

    return token;
  }
}

function hexToUint8Array(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Wraps a raw 32-byte secp256k1 private key in the proper PKCS8 ASN.1 DER
 * structure and returns it as a PEM string.
 *
 * PKCS8 structure for EC key (secp256k1):
 *   SEQUENCE {
 *     INTEGER 0                          -- version
 *     SEQUENCE {                         -- algorithm identifier
 *       OID 1.2.840.10045.2.1           -- ecPublicKey
 *       OID 1.3.132.0.10                -- secp256k1
 *     }
 *     OCTET STRING {
 *       SEQUENCE {                       -- ECPrivateKey (SEC 1)
 *         INTEGER 1                      -- version
 *         OCTET STRING (32 bytes)        -- private key
 *       }
 *     }
 *   }
 */
function rawSecp256k1ToPKCS8Pem(rawKey: Uint8Array): string {
  // prettier-ignore
  const pkcs8Header = new Uint8Array([
    0x30, 0x3e,                         // SEQUENCE (62 bytes)
    0x02, 0x01, 0x00,                   //   INTEGER 0 (version)
    0x30, 0x10,                         //   SEQUENCE (16 bytes) - algorithm
    0x06, 0x07,                         //     OID (7 bytes)
    0x2a, 0x86, 0x48, 0xce,             //       1.2.840.10045.2.1 (ecPublicKey)
    0x3d, 0x02, 0x01,
    0x06, 0x05,                         //     OID (5 bytes)
    0x2b, 0x81, 0x04, 0x00, 0x0a,       //       1.3.132.0.10 (secp256k1)
    0x04, 0x27,                         //   OCTET STRING (39 bytes)
    0x30, 0x25,                         //     SEQUENCE (37 bytes) - ECPrivateKey
    0x02, 0x01, 0x01,                   //       INTEGER 1 (version)
    0x04, 0x20,                         //       OCTET STRING (32 bytes)
  ]);

  const der = new Uint8Array(pkcs8Header.length + rawKey.length);
  der.set(pkcs8Header);
  der.set(rawKey, pkcs8Header.length);

  const b64 = Buffer.from(der).toString('base64');
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----`;
}
