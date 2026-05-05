import { Schema, model } from 'mongoose';
const auditTrailSchema = new Schema({
    at: {
        type: Date,
        required: true,
        default: Date.now,
    },
    action: {
        type: String,
        required: true,
    },
    by: {
        type: String,
        required: true,
    },
    meta: {
        type: Schema.Types.Mixed,
        default: null,
    },
});
const draftSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    gmailMessageId: {
        type: String,
        required: true,
    },
    threadId: {
        type: String,
        required: true,
        index: true,
    },
    tone: {
        type: String,
        enum: ['formal', 'concise', 'friendly'],
        required: true,
    },
    promptVersion: {
        type: String,
        required: true,
    },
    draftBody: {
        type: String,
        required: true,
    },
    status: {
        type: String,
        enum: ['PENDING', 'APPROVED', 'REJECTED', 'SENT'],
        default: 'PENDING',
        index: true,
    },
    approvedAt: {
        type: Date,
        default: null,
    },
    rejectedAt: {
        type: Date,
        default: null,
    },
    sentAt: {
        type: Date,
        default: null,
    },
    sentGmailMessageId: {
        type: String,
        default: null,
    },
    idempotencyKey: {
        type: String,
        default: null,
        sparse: true,
    },
    auditTrail: {
        type: [auditTrailSchema],
        default: [],
    },
}, { timestamps: true });
// Compound indexes
draftSchema.index({ userId: 1, status: 1, createdAt: -1 });
draftSchema.index({ userId: 1, idempotencyKey: 1 }, { sparse: true, unique: true });
export const Draft = model('Draft', draftSchema);
