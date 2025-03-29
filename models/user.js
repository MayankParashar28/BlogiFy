const { createHmac, randomBytes } = require("crypto");
const mongoose = require("mongoose");
const { createTokenForUser } = require("../Services/authencation");
const Blog = require("./blog");

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    fullName: {
      type: String,
      required: true,  // Keeping "require" as it is
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    salt: {
      type: String,
    },
    passward: {
      type: String,
      required: true,
    },

    bio: {
      type: String,
      default: "",
    },
    socials: {
      linkedin: {
        type: String,
        default: "",
      },
      twitter: {
        type: String,
        default: "",
      },
      github: {
        type: String,
        default: "",
      },
      instagram: {
        type: String,
        default: "",
      },
    },
    profilePic: {
      type: String,
      default: function () {
        return `https://api.dicebear.com/8.x/bottts/svg?seed=${encodeURIComponent(this.email)}`;
      },
    },
    profileViews: {  // ✅ New field to track profile views
      type: Number,
      default: 0,
    },
    following: {
      type: [Schema.Types.ObjectId],
      ref: "user",
      default: [],
    },
    followers: {
      type: [Schema.Types.ObjectId],
      ref: "user",
      default: [],
    },
    totalLikes: {
      type: Number,
      default: 0,
    },

    joinedDate: {
      type: Date,
      default: Date.now,
    },
    isSubscribed: {
      type: Boolean,
      default: false
    },
    stripeCustomerId: {
      type: String,
    },
    subscriptionId: {
      type: String,
    },
    lastProfileEdit: { 
      type: Date ,
    },
    bookmarks: [
      { 
        type: mongoose.Schema.Types.ObjectId,
         ref: "blog" 
        }
      ],
    
    role: {
      type: String,
      enum: ["USER", "ADMIN"],
      default: "USER",
    },
  },
  { timestamps: true }
);

// ✅ Hash password before saving user
userSchema.pre("save", function (next) {
  if (!this.isModified("passward")) return next(); // ⚠️ Typo here too

  const salt = "someRandomstring";
  this.salt = salt;
  this.passward = createHmac("sha256", salt)
    .update(this.passward)
    .digest("hex");

  next();
});

// ✅ Function to validate password and generate token
userSchema.statics.matchPasswardAndGenerateToken = async function (email, passward) {
  // console.log("🔍 Received email:", email);
  // console.log("🔍 Received password:", passward);

  const user = await this.findOne({ email });

  if (!user) {
    // console.log("❌ User not found");
    throw new Error("User not found");
  }

  // console.log("🟢 User found:", user.email);

  const salt = user.salt;
  const hashedPassward = user.passward;

  // console.log("🔍 User's hashed password from DB:", hashedPassward);
  // console.log("🔍 User's salt:", salt);

  const userProvideHashed = createHmac("sha256", salt)
    .update(passward)
    .digest("hex");

  // console.log("🔍 Hashed password from user input:", userProvideHashed);

  if (hashedPassward !== userProvideHashed) {
    // console.log("❌ Passwords do not match");
    throw new Error("Incorrect password");
  }

  // console.log("🟢 Passwords match! Generating token...");

  const token = createTokenForUser(user);
  // console.log("🟢 Token generated:", token);

  return token;
};


// Prevents overwriting the model if already compiled
const User = mongoose.models.user || mongoose.model("user", userSchema);

module.exports = User;