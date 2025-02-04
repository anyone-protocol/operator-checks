import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type BalancesDataDocument = HydratedDocument<BalancesData>

@Schema()
export class BalancesData {
  @Prop({ type: Number, required: true })
  stamp: number

  @Prop({ type: String })
  kind: string

  @Prop({ type: String })
  amount: string

  @Prop({ type: String})
  requestAmount?: string
}

export const BalancesDataSchema = SchemaFactory.createForClass(BalancesData)
