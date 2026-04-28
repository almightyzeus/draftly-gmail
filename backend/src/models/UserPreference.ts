import { Schema, model, Document, Types } from 'mongoose';

export type ToneType = 'formal' | 'concise' | 'friendly';

export interface IUserPreference extends Document {
  userId: Types.ObjectId;
  defaultTone: ToneType;
  signature: string;
  learningEmailCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const userPreferenceSchema = new Schema<IUserPreference>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    defaultTone: {
      type: String,
      enum: ['formal', 'concise', 'friendly'],
      default: 'formal',
    },
    signature: {
      type: String,
      default: '',
    },
    learningEmailCount: {
      type: Number,
      default: 5,
      min: 1,
      max: 20,
    },
  },
  { timestamps: true }
);

export const UserPreference = model<IUserPreference>('UserPreference', userPreferenceSchema);
