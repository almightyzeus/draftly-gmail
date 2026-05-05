import { Schema, model } from 'mongoose';
const emailMessageSchema = new Schema({
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
    from: {
        type: String,
        required: true,
    },
    to: {
        type: String,
        required: true,
    },
    subject: {
        type: String,
        required: true,
    },
    snippet: {
        type: String,
        required: true,
    },
    bodyPlain: {
        type: String,
        required: true,
    },
    bodyHtml: {
        type: String,
        default: null,
    },
    internalDate: {
        type: Date,
        required: true,
        index: true,
    },
    direction: {
        type: String,
        enum: ['INBOUND', 'OUTBOUND'],
        required: true,
        index: true,
    },
    labels: {
        type: [String],
        default: [],
    },
}, { timestamps: true });
// Compound index for efficient queries
emailMessageSchema.index({ userId: 1, direction: 1, internalDate: -1 });
emailMessageSchema.index({ userId: 1, gmailMessageId: 1 }, { unique: true });
export const EmailMessage = model('EmailMessage', emailMessageSchema);
