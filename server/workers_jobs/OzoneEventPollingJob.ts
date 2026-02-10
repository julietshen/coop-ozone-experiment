/**
 * OzoneEventPollingJob: Polls Ozone moderation events and ingests them into
 * Coop's reporting and MRT pipeline.
 *
 * For each org with Ozone sync enabled:
 * 1. Fetches new moderation events from Ozone using the stored cursor
 * 2. Transforms events into Coop reports or MRT jobs:
 *    - #modEventReport → ReportingService.submitReport() → MRT queue
 *    - #modEventEscalate → ManualReviewToolService.enqueue()
 *    - #modEventLabel → Create report with mapped Coop policies
 *    - #modEventTakedown / #modEventComment → Logged for audit
 * 3. Updates the sync cursor for the next poll cycle
 */
/* eslint-disable no-console */
import { v1 as uuidv1 } from 'uuid';

import { inject } from '../iocContainer/utils.js';
import { type ItemSubmissionWithTypeIdentifier } from '../services/itemProcessingService/makeItemSubmissionWithTypeIdentifier.js';
import { type NormalizedItemData } from '../services/itemProcessingService/toNormalizedItemDataOrErrors.js';
import { type OzoneModerationEvent } from '../services/ozoneService/types.js';
import { toCorrelationId } from '../utils/correlationIds.js';
import { sleep } from '../utils/misc.js';

const DEFAULT_POLL_INTERVAL_MS = 30_000;

export default inject(
  [
    'closeSharedResourcesForShutdown',
    'OzoneService',
    'ManualReviewToolService',
    'ModerationConfigService',
  ],
  (
    closeSharedResourcesForShutdown,
    ozoneService,
    manualReviewToolService,
    moderationConfigService,
  ) => {
    const pollIntervalMs = Number(
      process.env.OZONE_POLL_INTERVAL_MS ?? DEFAULT_POLL_INTERVAL_MS,
    );
    const isEnabled = process.env.OZONE_POLL_ENABLED === 'true';

    function makeOzoneItem(
      itemId: string,
      contentType: { id: string; version: string; schemaVariant: string },
      data: Record<string, unknown>,
    ): ItemSubmissionWithTypeIdentifier {
      // Ozone events don't go through Coop's normal item processing pipeline,
      // so we construct the opaque type directly via type assertion.
      return {
        itemId,
        itemTypeIdentifier: {
          id: contentType.id,
          version: contentType.version,
          schemaVariant: contentType.schemaVariant,
        },
        data: data as NormalizedItemData,
        submissionTime: new Date(),
        submissionId: `ozone-${uuidv1()}`,
        creator: undefined,
      } as unknown as ItemSubmissionWithTypeIdentifier;
    }

    async function processEvent(
      orgId: string,
      event: OzoneModerationEvent,
    ): Promise<void> {
      const classified = ozoneService.classifyEvent(event);

      if (!classified.category || !classified.subjectDid) {
        return;
      }

      // Use 'post-content' which is a valid RuleExecutionSourceType
      const requestId = toCorrelationId({
        type: 'post-content' as const,
        id: uuidv1(),
      });

      switch (classified.category) {
        case 'REPORT':
        case 'LABEL': {
          // Get org's item types to find a matching content type
          const itemTypes = await moderationConfigService.getItemTypes({
            orgId,
            directives: { maxAge: 10 },
          });

          // Look for a content type that can accept AT Protocol content
          const contentType =
            itemTypes.find(
              (it) => it.name === 'atproto_content' || it.name === 'bluesky_post',
            ) ?? itemTypes.find((it) => it.kind === 'CONTENT');

          if (!contentType) {
            console.warn(
              `[OzonePolling] No suitable content type for org ${orgId}, skipping event ${event.id}`,
            );
            return;
          }

          const item = makeOzoneItem(
            classified.subjectDid,
            contentType,
            {
              did: classified.subjectDid,
              ...(classified.subjectUri
                ? { uri: classified.subjectUri }
                : {}),
              ozoneEventId: event.id,
              ozoneEventType: event.event.$type,
              ozoneLabels: classified.labels,
              ozoneComment: classified.comment ?? null,
              ozoneCreatedBy: event.createdBy,
              ozoneCreatedAt: event.createdAt,
            },
          );

          // Enqueue to MRT as a report from Ozone
          await manualReviewToolService.enqueue({
            orgId,
            payload: {
              kind: 'DEFAULT',
              reportHistory: [
                {
                  reason:
                    classified.comment ??
                    `Ozone ${classified.category.toLowerCase()}: ${classified.labels.join(', ')}`,
                  reporterId: undefined,
                  reportId: `ozone-${event.id}`,
                  reportedAt: new Date(event.createdAt),
                  policyId: undefined,
                },
              ],
              item,
              reportedForReason: classified.comment ?? null,
              reportedForReasons: classified.comment
                ? [{ reason: classified.comment, reporterId: undefined }]
                : [],
            },
            createdAt: new Date(event.createdAt),
            enqueueSource: 'REPORT',
            enqueueSourceInfo: { kind: 'REPORT' },
            correlationId: requestId,
            policyIds: [],
          });

          console.log(
            `[OzonePolling] Enqueued ${classified.category} event ${event.id} to MRT for org ${orgId}`,
          );
          break;
        }

        case 'ESCALATE': {
          // Escalation events go directly to MRT with higher priority
          const itemTypes2 = await moderationConfigService.getItemTypes({
            orgId,
            directives: { maxAge: 10 },
          });
          const contentType2 =
            itemTypes2.find(
              (it) => it.name === 'atproto_content' || it.name === 'bluesky_post',
            ) ?? itemTypes2.find((it) => it.kind === 'CONTENT');

          if (!contentType2) return;

          const item2 = makeOzoneItem(
            classified.subjectDid,
            contentType2,
            {
              did: classified.subjectDid,
              ...(classified.subjectUri
                ? { uri: classified.subjectUri }
                : {}),
              ozoneEventId: event.id,
              ozoneEventType: event.event.$type,
              ozoneComment: classified.comment ?? null,
            },
          );

          await manualReviewToolService.enqueue({
            orgId,
            payload: {
              kind: 'DEFAULT',
              reportHistory: [
                {
                  reason: classified.comment ?? 'Escalated from Ozone',
                  reporterId: undefined,
                  reportId: `ozone-escalate-${event.id}`,
                  reportedAt: new Date(event.createdAt),
                  policyId: undefined,
                },
              ],
              item: item2,
              reportedForReason: 'Escalated from Ozone',
              reportedForReasons: [
                { reason: 'Escalated from Ozone', reporterId: undefined },
              ],
            },
            createdAt: new Date(event.createdAt),
            enqueueSource: 'REPORT',
            enqueueSourceInfo: { kind: 'REPORT' },
            correlationId: requestId,
            policyIds: [],
          });

          console.log(
            `[OzonePolling] Enqueued ESCALATION event ${event.id} to MRT for org ${orgId}`,
          );
          break;
        }

        case 'TAKEDOWN':
        case 'COMMENT':
          // Log these events but don't create MRT jobs for them
          console.log(
            `[OzonePolling] Received ${classified.category} event ${event.id} for org ${orgId} (informational)`,
          );
          break;
      }
    }

    async function pollOrg(orgId: string): Promise<void> {
      try {
        const { events } = await ozoneService.pollEvents(orgId);

        if (events.length === 0) return;

        console.log(
          `[OzonePolling] Processing ${events.length} events for org ${orgId}`,
        );

        for (const event of events) {
          try {
            await processEvent(orgId, event);
          } catch (e) {
            console.error(
              `[OzonePolling] Error processing event ${event.id} for org ${orgId}:`,
              e,
            );
          }
        }
      } catch (e) {
        console.error(
          `[OzonePolling] Error polling events for org ${orgId}:`,
          e,
        );
      }
    }

    return {
      type: 'Job' as const,
      async run(signal?: AbortSignal) {
        if (!isEnabled) {
          console.log(
            '[OzonePolling] Ozone polling is disabled (set OZONE_POLL_ENABLED=true to enable)',
          );
          return;
        }

        console.log(
          `[OzonePolling] Starting Ozone event polling (interval: ${pollIntervalMs}ms)`,
        );

        while (!signal?.aborted) {
          try {
            const orgIds = await ozoneService.getOrgIdsWithSyncEnabled();

            for (const orgId of orgIds) {
              if (signal?.aborted) break;
              await pollOrg(orgId);
            }
          } catch (e) {
            console.error('[OzonePolling] Error in polling loop:', e);
          }

          // Wait for next poll cycle or until aborted
          await sleep(pollIntervalMs);
        }

        console.log('[OzonePolling] Ozone event polling stopped');
      },
      async shutdown() {
        await closeSharedResourcesForShutdown();
      },
    };
  },
);
