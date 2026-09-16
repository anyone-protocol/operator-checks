import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type PublishingLagStateDocument = HydratedDocument<PublishingLagState>

/**
 * When a process FIRST got ahead of what is published, per (process, slot).
 *
 * 🚨 WHY THIS HAS TO BE PERSISTED.
 * The only timestamp Arweave gives us is the block time of the PREVIOUS assignment, and that is
 * routinely 25-60 min old on an hourly cadence and 500+ min old for event-driven
 * operator-registry, even when everything is healthy. Using it as the lag reference fires the
 * alarm the instant the node advances a slot, then resolves when the new assignment indexes -
 * so it flapped once per round on every contract.
 *
 * The node exposes no per-slot timestamp (`compute&slot=N/timestamp` is a 404), so there is no
 * stateless way to ask "how long has THIS slot been unpublished". We record first-seen ourselves.
 *
 * Keyed by process AND slot: when the slot moves on, the old row is irrelevant, and a fresh row
 * restarts the clock. Rows are cleared as soon as the process is caught up.
 */
@Schema()
export class PublishingLagState {
  @Prop({ type: String, required: true, index: true })
  process: string

  @Prop({ type: Number, required: true })
  slot: number

  @Prop({ type: Number, required: true })
  firstSeenAt: number
}

export const PublishingLagStateSchema = SchemaFactory.createForClass(PublishingLagState)
PublishingLagStateSchema.index({ process: 1, slot: 1 }, { unique: true })
