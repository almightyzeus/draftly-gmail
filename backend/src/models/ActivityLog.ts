import { Schema, model, Document, Types } from 'mongoose';

export type LogLevel = 'info' | 'warn' | 'error';

export interface IActivityLog extends Document {
  userId: Types.ObjectId;
  action: string;
  entityType: string;
  entityId?: string;
  level: LogLevel;
  meta?: Record<string, any>;
  createdAt: Date;
}

const activityLogSchema = new Schema<IActivityLog>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
    },
    entityType: {
      type: String,
      required: true,
    },
    entityId: {
      type: String,
      default: null,
    },
    level: {
      type: String,
      enum: ['info', 'warn', 'error'],
      default: 'info',
      index: true,
    },
    meta: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false } }
);

// Index for efficient queries
activityLogSchema.index({ userId: 1, createdAt: -1 });

export const ActivityLog = model<IActivityLog>('ActivityLog', activityLogSchema);
