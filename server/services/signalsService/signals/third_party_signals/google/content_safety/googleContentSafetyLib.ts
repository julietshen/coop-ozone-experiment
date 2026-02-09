import {type ReadonlyDeep} from 'type-fest';
import {fetchWithTimeout} from './fetch_utils';

export const GOOGLE_CONTENT_SAFETY_PRIORITIES = [
  'VERY_LOW',
  'LOW',
  'MEDIUM',
  'HIGH',
  'VERY_HIGH',
] as const;

export type GoogleContentSafetyPriority =
  (typeof GOOGLE_CONTENT_SAFETY_PRIORITIES)[number];

export interface GoogleContentSafetyOptions {
  apiKey: string;
  /** Timeout for requests to the API in milliseconds. */
  timeoutMs?: number;
}

export interface ClassificationResult {
  reviewPriorities: GoogleContentSafetyPriority[];
  modelVersion?: string;
}

export class GoogleContentSafetyClient {
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly baseUrl =
    'https://contentsafety.googleapis.com/v1beta1/images:classify';

  constructor(options: GoogleContentSafetyOptions) {
    if (!options.apiKey) {
      throw new Error('Google Content Safety API key is required.');
    }
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /**
   * Classifies a single raw image (Buffer or Uint8Array).
   *
   * Prefer `classifyImages` when classifying multiple images.
   */
  public async classifyImage(
    image: Buffer | Uint8Array,
  ): Promise<GoogleContentSafetyPriority | undefined> {
    const priorities = await this.classifyImages([image]);
    return priorities[0];
  }

  /**
   * Classifies a list of raw images (Buffer or Uint8Array).
   *
   * This method is preferred over calling `classifyImage` multiple times, as it
   * batches the images into a single API request.
   */
  public async classifyImages(
    images: (Buffer | Uint8Array)[],
  ): Promise<ReadonlyDeep<GoogleContentSafetyPriority[]>> {
    const url = `${this.baseUrl}?key=${this.apiKey}`;

    const reqBody = {
      images: images.map((image) => {
        if (Buffer.isBuffer(image)) {
          return image.toString('base64');
        }
        return Buffer.from(image).toString('base64');
      }),
    };

    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(reqBody),
        },
        this.timeoutMs,
      );

      if (!response.ok) {
        throw new Error(
          `Google Content Safety API request failed with status ${response.status}: ${response.statusText}`,
        );
      }

      const responseJson = (await response.json()) as {
        reviewPriorities: GoogleContentSafetyPriority[];
        model_version: string;
      };

      return responseJson.reviewPriorities;
    } catch (error: unknown) {
      // Map known errors or rethrow
      if (error instanceof Error) {
        throw new Error(`Google Content Safety API Error: ${error.message}`);
      }
      throw error;
    }
  }
}

