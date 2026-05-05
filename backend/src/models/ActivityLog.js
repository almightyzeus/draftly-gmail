import { Schema, model } from 'mongoose';
const activityLogSchema = new Schema({
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
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });
// Index for efficient queries
activityLogSchema.index({ userId: 1, createdAt: -1 });
export const ActivityLog = model('ActivityLog', activityLogSchema);
