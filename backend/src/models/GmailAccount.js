import { Schema, model } from 'mongoose';
const gmailAccountSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    gmailEmail: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
    },
    accessTokenEnc: {
        type: String,
        required: true,
    },
    refreshTokenEnc: {
        type: String,
        required: true,
    },
    tokenExpiry: {
        type: Date,
        required: true,
    },
    scopes: {
        type: [String],
        default: [],
    },
    revokedAt: {
        type: Date,
        default: null,
    },
}, { timestamps: true });
// Index for quick lookup by userId
gmailAccountSchema.index({ userId: 1, revokedAt: 1 });
export const GmailAccount = model('GmailAccount', gmailAccountSchema);
