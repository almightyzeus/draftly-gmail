import { Schema, model, Document, Types } from 'mongoose';

export interface IGmailAccount extends Document {
  userId: Types.ObjectId;
  gmailEmail: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  tokenExpiry: Date;
  scopes: string[];
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const gmailAccountSchema = new Schema<IGmailAccount>(
  {
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
  },
  { timestamps: true }
);

// Index for quick lookup by userId
gmailAccountSchema.index({ userId: 1, revokedAt: 1 });
gmailAccountSchema.index({ userId: 1, gmailEmail: 1 }, { unique: true });

export const GmailAccount = model<IGmailAccount>('GmailAccount', gmailAccountSchema);
