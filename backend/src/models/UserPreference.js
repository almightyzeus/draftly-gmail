import { Schema, model } from 'mongoose';
const userPreferenceSchema = new Schema({
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
}, { timestamps: true });
export const UserPreference = model('UserPreference', userPreferenceSchema);
