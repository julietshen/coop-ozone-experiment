/**
 * OzoneService coordinates bidirectional communication between Coop and a
 * self-hosted Ozone moderation instance.
 *
 * Outbound (Coop → Ozone): Emits moderation events (labels, takedowns, etc.)
 * when Coop's rules engine or MRT makes a decision.
 *
 * Inbound (Ozone → Coop): Polls for new moderation events and transforms
 * them into Coop reports or MRT jobs.
 */
import { type Kysely } from 'kysely';

import { type Dependencies } from '../../iocContainer/index.js';
import { inject } from '../../iocContainer/utils.js';
import { jsonStringify } from '../../utils/encoding.js';
import { type OzoneCredential } from '../signalAuthService/signalAuthService.js';
import { type OzoneServicePg } from './dbTypes.js';
import {
  type LabelMapping,
  coopPolicyToOzoneLabels,
  getEffectiveMappings,
  ozoneLabelToCoopPolicies,
  ozoneEventTypeToCoopCategory,
} from './labelMapping.js';
import { OzoneApiClient, type OzoneClientConfig } from './ozoneApiClient.js';
import {
  toOzoneEventDef,
  type CoopOzoneEventType,
  type OzoneModerationEvent,
  type OzoneQueryEventsResponse,
  type OzoneSyncState,
} from './types.js';

export class OzoneService {
  constructor(
    private readonly pg: Kysely<OzoneServicePg>,
    private readonly fetchHTTP: Dependencies['fetchHTTP'],
    private readonly signalAuthService: Dependencies['SignalAuthService'],
    private readonly tracer: Dependencies['Tracer'],
  ) {}

  // ---------------------------------------------------------------------------
  // Outbound: Coop → Ozone
  // ---------------------------------------------------------------------------

  /**
   * Emit a moderation event to Ozone. Called by ActionPublisher when
   * a rule or MRT decision triggers an EMIT_OZONE_EVENT action.
   */
  async emitEvent(params: {
    orgId: string;
    eventType: CoopOzoneEventType;
    labels: string[];
    negateLabels?: string[];
    comment: string | null;
    subjectDid: string;
    subjectUri?: string;
    coopActionId: string;
    coopCorrelationId: string;
    policies: readonly { id: string; name: string }[];
    durationInHours?: number;
  }): Promise<void> {
    const {
      orgId,
      eventType,
      labels,
      negateLabels,
      comment,
      subjectDid,
      subjectUri,
      coopActionId,
      coopCorrelationId,
      durationInHours,
    } = params;

    const client = await this.getClient(orgId);
    if (!client) {
      throw new Error(
        `Ozone is not configured for org ${orgId}. Configure Ozone credentials first.`,
      );
    }

    const credential = (await this.signalAuthService.get(
      'OZONE',
      orgId,
    ))!;

    // Build the Ozone event definition
    const eventDef = toOzoneEventDef(eventType, {
      labels,
      negateLabels,
      comment: comment ??
        `Coop moderation action: ${params.policies.map((p) => p.name).join(', ')}`,
      durationInHours,
    });

    // Determine subject reference
    const subject = subjectUri
      ? {
          $type: 'com.atproto.repo.strongRef' as const,
          uri: subjectUri,
          cid: '', // CID may not be known; Ozone accepts empty for some operations
        }
      : {
          $type: 'com.atproto.admin.defs#repoRef' as const,
          did: subjectDid,
        };

    // Record the outbound event before sending (for audit trail)
    const [eventRecord] = await this.pg
      .insertInto('ozone_service.emitted_events')
      .values({
        org_id: orgId,
        ozone_event_type: eventType,
        subject_did: subjectDid,
        subject_uri: subjectUri ?? null,
        coop_action_id: coopActionId,
        coop_correlation_id: coopCorrelationId,
        status: 'PENDING',
        ozone_response: null,
        error: null,
        retry_count: 0,
      })
      .returning(['id'])
      .execute();

    try {
      const response = await client.emitEvent({
        event: eventDef,
        subject,
        createdBy: credential.did,
      });

      // Update with success
      await this.pg
        .updateTable('ozone_service.emitted_events')
        .set({
          status: 'SUCCESS',
          ozone_response: response as unknown as Record<string, unknown>,
        })
        .where('id', '=', eventRecord.id)
        .execute();
    } catch (e) {
      // Record failure
      await this.pg
        .updateTable('ozone_service.emitted_events')
        .set({
          status: 'RETRYABLE_ERROR',
          error: e instanceof Error ? e.message : String(e),
        })
        .where('id', '=', eventRecord.id)
        .execute();

      throw e;
    }
  }

  // ---------------------------------------------------------------------------
  // Inbound: Ozone → Coop
  // ---------------------------------------------------------------------------

  /**
   * Poll for new moderation events from Ozone. Returns transformed events
   * ready to be ingested into Coop's reporting/MRT pipeline.
   */
  async pollEvents(orgId: string): Promise<{
    events: OzoneModerationEvent[];
    newCursor: string | undefined;
  }> {
    const client = await this.getClient(orgId);
    if (!client) {
      return { events: [], newCursor: undefined };
    }

    const syncState = await this.getSyncState(orgId);
    if (!syncState?.syncEnabled) {
      return { events: [], newCursor: undefined };
    }

    const response: OzoneQueryEventsResponse = await client.queryEvents({
      cursor: syncState.lastSyncedCursor ?? undefined,
      limit: 100,
      sortDirection: 'asc',
    });

    // Update cursor
    if (response.cursor) {
      await this.updateSyncState(orgId, {
        lastSyncedCursor: response.cursor,
        lastSyncedAt: new Date(),
      });
    }

    return {
      events: response.events,
      newCursor: response.cursor,
    };
  }

  /**
   * Classify an Ozone event for Coop's ingestion pipeline.
   */
  classifyEvent(event: OzoneModerationEvent): {
    category: 'REPORT' | 'TAKEDOWN' | 'LABEL' | 'COMMENT' | 'ESCALATE' | null;
    labels: string[];
    comment: string | undefined;
    subjectDid: string | undefined;
    subjectUri: string | undefined;
  } {
    const category = ozoneEventTypeToCoopCategory(event.event.$type);
    const labels = event.event.createLabelVals ?? [];
    const comment =
      typeof event.event.comment === 'string'
        ? event.event.comment
        : undefined;

    let subjectDid: string | undefined;
    let subjectUri: string | undefined;

    if (event.subject.$type === 'com.atproto.admin.defs#repoRef') {
      subjectDid = event.subject.did;
    } else if (event.subject.$type === 'com.atproto.repo.strongRef') {
      subjectUri = event.subject.uri;
      // Extract DID from at:// URI
      const match = event.subject.uri.match(/^at:\/\/(did:[^/]+)/);
      if (match) {
        subjectDid = match[1];
      }
    }

    return { category, labels, comment, subjectDid, subjectUri };
  }

  /**
   * Map Ozone labels to Coop policy types using org-specific or default mappings.
   */
  async mapLabelsToPolicies(
    orgId: string,
    ozoneLabels: string[],
  ): Promise<string[]> {
    const mappings = await this.getLabelMappings(orgId);
    return ozoneLabelToCoopPolicies(mappings, ozoneLabels);
  }

  /**
   * Map Coop policy type to Ozone labels using org-specific or default mappings.
   */
  async mapPolicyToLabels(
    orgId: string,
    coopPolicyType: string,
  ): Promise<string[]> {
    const mappings = await this.getLabelMappings(orgId);
    return coopPolicyToOzoneLabels(mappings, coopPolicyType);
  }

  // ---------------------------------------------------------------------------
  // Label mapping CRUD
  // ---------------------------------------------------------------------------

  async getLabelMappings(orgId: string): Promise<LabelMapping[]> {
    const rows = await this.pg
      .selectFrom('ozone_service.label_mappings')
      .select(['coop_policy_type', 'ozone_label_value', 'direction'])
      .where('org_id', '=', orgId)
      .execute();

    return rows.map((row) => ({
      coopPolicyType: row.coop_policy_type,
      ozoneLabelValue: row.ozone_label_value,
      direction: row.direction as LabelMapping['direction'],
    }));
  }

  async setLabelMapping(
    orgId: string,
    mapping: LabelMapping,
  ): Promise<void> {
    await this.pg
      .insertInto('ozone_service.label_mappings')
      .values({
        org_id: orgId,
        coop_policy_type: mapping.coopPolicyType,
        ozone_label_value: mapping.ozoneLabelValue,
        direction: mapping.direction,
      })
      .onConflict((oc) =>
        oc
          .columns(['org_id', 'coop_policy_type', 'ozone_label_value'])
          .doUpdateSet({ direction: mapping.direction }),
      )
      .execute();
  }

  async deleteLabelMapping(
    orgId: string,
    coopPolicyType: string,
    ozoneLabelValue: string,
  ): Promise<void> {
    await this.pg
      .deleteFrom('ozone_service.label_mappings')
      .where('org_id', '=', orgId)
      .where('coop_policy_type', '=', coopPolicyType)
      .where('ozone_label_value', '=', ozoneLabelValue)
      .execute();
  }

  // ---------------------------------------------------------------------------
  // Sync state management
  // ---------------------------------------------------------------------------

  async getSyncState(orgId: string): Promise<OzoneSyncState | null> {
    const row = await this.pg
      .selectFrom('ozone_service.event_sync_state')
      .select([
        'org_id',
        'last_synced_cursor',
        'last_synced_at',
        'sync_enabled',
      ])
      .where('org_id', '=', orgId)
      .executeTakeFirst();

    if (!row) return null;

    return {
      orgId: row.org_id,
      lastSyncedCursor: row.last_synced_cursor,
      lastSyncedAt: row.last_synced_at,
      syncEnabled: row.sync_enabled,
    };
  }

  async updateSyncState(
    orgId: string,
    state: Partial<Omit<OzoneSyncState, 'orgId'>>,
  ): Promise<void> {
    await this.pg
      .insertInto('ozone_service.event_sync_state')
      .values({
        org_id: orgId,
        last_synced_cursor: state.lastSyncedCursor ?? null,
        last_synced_at: state.lastSyncedAt ?? null,
        sync_enabled: state.syncEnabled ?? true,
      })
      .onConflict((oc) =>
        oc.column('org_id').doUpdateSet({
          ...(state.lastSyncedCursor !== undefined && {
            last_synced_cursor: state.lastSyncedCursor,
          }),
          ...(state.lastSyncedAt !== undefined && {
            last_synced_at: state.lastSyncedAt,
          }),
          ...(state.syncEnabled !== undefined && {
            sync_enabled: state.syncEnabled,
          }),
          updated_at: new Date(),
        }),
      )
      .execute();
  }

  // ---------------------------------------------------------------------------
  // Configuration helpers
  // ---------------------------------------------------------------------------

  async isConfigured(orgId: string): Promise<boolean> {
    const credential = await this.signalAuthService.get('OZONE', orgId);
    return credential != null;
  }

  async getOrgIdsWithSyncEnabled(): Promise<string[]> {
    const rows = await this.pg
      .selectFrom('ozone_service.event_sync_state')
      .select(['org_id'])
      .where('sync_enabled', '=', true)
      .execute();

    return rows.map((r) => r.org_id);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async getClient(orgId: string): Promise<OzoneApiClient | null> {
    const credential = await this.signalAuthService.get('OZONE', orgId);
    if (!credential) return null;

    return new OzoneApiClient(this.fetchHTTP, {
      serviceUrl: credential.serviceUrl,
      did: credential.did,
      signingKey: credential.signingKey,
    });
  }
}

export default inject(
  ['KyselyPg', 'fetchHTTP', 'SignalAuthService', 'Tracer'],
  OzoneService,
);
export { type OzoneService as OzoneServiceType };
