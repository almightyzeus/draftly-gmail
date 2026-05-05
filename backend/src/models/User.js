import { Schema, model } from 'mongoose';
import bcryptjs from 'bcryptjs';
const userSchema = new Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        match: /.+\@.+\..+/,
    },
    name: {
        type: String,
        required: true,
    },
    passwordHash: {
        type: String,
        required: true,
    },
    googleConnected: {
        type: Boolean,
        default: false,
        index: true,
    },
    gmailEmail: {
        type: String,
        lowercase: true,
        trim: true,
        default: null,
    },
}, { timestamps: true });
// Hash password before saving
userSchema.pre('save', async function () {
    if (!this.isModified('passwordHash'))
        return;
    try {
        const salt = await bcryptjs.genSalt(10);
        this.passwordHash = await bcryptjs.hash(this.passwordHash, salt);
    }
    catch (error) {
        throw error;
    }
});
// Method to compare password
userSchema.methods.comparePassword = async function (password) {
    return bcryptjs.compare(password, this.passwordHash);
};
export const User = model('User', userSchema);
