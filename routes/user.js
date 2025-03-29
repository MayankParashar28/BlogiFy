const { Router } = require("express");
const mongoose = require("mongoose"); // ✅ Import mongoose
const Notification = require("../models/Notification");
const createTokenForUser = require("../Services/authencation");
const router = Router();
const io = require("../index").io;
require('dotenv').config();
const jwt = require("jsonwebtoken");

const { checkForAuthencationCookie } = require("../middleware/authencation");

const User = require("../models/user");
const Blog = require("../models/blog");
const Comment = require("../models/comment");

// view other user profile
router.get("/profile/:userId", async (req, res) => {
  try {
      const { userId } = req.params;

      if (!userId.match(/^[0-9a-fA-F]{24}$/)) {
          return res.status(400).send("Invalid user ID");
      }

      const user = await User.findById(userId);
      if (!user) return res.status(404).send("User not found");

      const blogs = await Blog.find({ createdBy: user._id }).sort({ createdAt: -1 });

      let isOwnProfile = false;

      // ✅ Check if user is logged in
      if (req.cookies.token) {
          try {
              const decoded = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
              if (decoded._id.toString() === userId) {
                  isOwnProfile = true;
              }
          } catch (err) {
              console.error("❌ Token Verification Failed:", err);
          }
      }

      // ✅ Pass `isOwnProfile` to EJS
      if (isOwnProfile) {
          return res.render("profile", { user, blogs, isAuthenticated: !!req.user, isOwnProfile });
      } else {
          return res.render("visitprofile", { user, blogs, isOwnProfile });
      }

  } catch (error) {
      console.error("❌ Error fetching profile:", error);
      res.status(500).send("Server error");
  }
});

//check bookmark
router.get("/check-bookmark/:blogId", async (req, res) => {
  if (!req.user) return res.json({ isBookmarked: false });

  try {
    const user = await User.findById(req.user._id);
    const isBookmarked = user.bookmarks.includes(req.params.blogId);
    res.json({ isBookmarked });
  } catch (error) {
    console.error("❌ Error checking bookmark:", error);
    res.status(500).json({ isBookmarked: false });
  }
});

// Profile Edit - GET Form
router.get("/edit", async (req, res) => {
  try {
      const user = await User.findById(req.user._id);
      if (!user) return res.redirect("/user/signin");

      res.render("editprofile", { user });
  } catch (err) {
      console.error(err);
      res.redirect("/user/profile/" + req.user._id);
  }
});

// Profile Edit - POST Update
router.post("/edit-profile", async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      req.flash("error", "Unauthorized access!");
      return res.status(400).json({ error: "Unauthorized access!" }); // Send error response to the frontend
    }

    const { fullName, email, bio, socials = {} } = req.body;
    const user = await User.findById(req.user._id);

    if (!user) {
      req.flash("error", "User not found!");
      return res.status(404).json({ error: "User not found!" }); // Send error response to the frontend
    }

    // Check if the user is trying to edit too frequently
    const now = new Date();
    const cooldownPeriod = 24 * 60 * 60 * 1000; // 24 hours
    const timeSinceLastEdit = now - user.lastProfileEdit;

    if (user.lastProfileEdit && timeSinceLastEdit < cooldownPeriod) {
      const remainingTime = Math.ceil((cooldownPeriod - timeSinceLastEdit) / 1000 / 60 / 60); // in hours
      req.flash("error", `You can only edit your profile once every 24 hours. Please try again in ${remainingTime} hour(s).`);
      return res.status(400).json({ error: `You can only edit your profile once every 24 hours. Please try again in ${remainingTime} hour(s).` });
    }

    // Validate inputs
    if (!fullName.trim()) {
      req.flash("error", "Full name cannot be empty!");
      return res.status(400).json({ error: "Full name cannot be empty." });
    }

    if (!email.match(/^\S+@\S+\.\S+$/)) {
      req.flash("error", "Invalid email format!");
      return res.status(400).json({ error: "Invalid email format." });
    }

    // Sanitize user input
    user.fullName = fullName.trim();
    user.email = email.trim();
    user.bio = bio ? bio.replace(/</g, "&lt;").replace(/>/g, "&gt;") : "";

    user.socials = {
      linkedin: socials.linkedin || "",
      twitter: socials.twitter || "",
      github: socials.github || "",
      instagram: socials.instagram || "",
    };

    user.lastProfileEdit = now;  // Update the last profile edit timestamp

    await user.save();

    // Send success response to the frontend
    return res.status(200).json({ success: "Profile updated successfully!" });

  } catch (error) {
    console.error(error);
    req.flash("error", "Something went wrong!");
    return res.status(500).json({ error: "Something went wrong!" });
  }
});
//profile
router.get("/profile", async (req, res) => {
  if (!req.cookies.token) {
    return res.status(401).send("No token found, authentication failed.");
  }

  try {
    const decoded = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
    const user = await User.findById(decoded._id).populate("bookmarks");
    if (!user) {
      return res.status(404).send("User not found");
    }

    const userId = new mongoose.Types.ObjectId(user._id);

    // Fetch blog count, total likes, and monthly activity in one query
    const blogStats = await Blog.aggregate([
      { $match: { createdBy: userId } },
      {
        $group: {
          _id: { $month: "$createdAt" },
          blogs: { $sum: 1 },
          totalLikes: { $sum: "$likes" }
        }
      },
      { $sort: { "_id": 1 } }
    ]);

    // Initialize default values for all 12 months
    const activityData = Array.from({ length: 12 }, () => ({ blogs: 0, totalLikes: 0, comments: 0 }));

    // Populate activityData with fetched values
    blogStats.forEach(entry => {
      activityData[entry._id - 1].blogs = entry.blogs;
      activityData[entry._id - 1].totalLikes = entry.totalLikes;
    });

    // Fetch blog IDs and count them
    const userBlogs = await Blog.find({ createdBy: userId }).select("_id");
    const blogIds = userBlogs.map(blog => blog._id);
    const blogCount = userBlogs.length;

    // Fetch total comments and monthly comment activity
    const commentStats = await Comment.aggregate([
      { $match: { blogId: { $in: blogIds } } },
      {
        $group: {
          _id: { $month: "$createdAt" },
          totalComments: { $sum: 1 }
        }
      },
      { $sort: { "_id": 1 } }
    ]);

    // Add comment data to activityData
    commentStats.forEach(entry => {
      activityData[entry._id - 1].comments = entry.totalComments;
    });

    // Count total comments
    const totalComments = commentStats.reduce((sum, entry) => sum + entry.totalComments, 0);

    // ✅ Pass Data to EJS
    res.render("profile", {
      user,
      blogCount,
      totalLikes: activityData.reduce((sum, entry) => sum + entry.totalLikes, 0), // Summing up likes
      totalComments,
      monthlyActivity: activityData, // Send to frontend for D3.js
      bookmarks: user.bookmarks,
      searchQuery: ""
    });

  } catch (error) {
    console.error("❌ Error verifying token:", error);
    res.status(500).send("Something went wrong");
  }
});

// Follow a user
router.post("/follow/:userId", async (req, res) => {
  try {
    if (!req.user) {
      console.error("❌ Error: User not logged in");
      req.flash("error", "You must be logged in to follow!");
      return res.redirect("back");
    }

    const userToFollow = await User.findById(req.params.userId).exec();
    const user = await User.findById(req.user._id).exec();

    if (!userToFollow) {
      console.error(`❌ Error: User to follow not found (ID: ${req.params.userId})`);
      req.flash("error", "User not found!");
      return res.redirect("back");
    }

    if (!user) {
      console.error(`❌ Error: Requesting user not found (ID: ${req.user._id})`);
      req.flash("error", "Something went wrong. Please try again!");
      return res.redirect("back");
    }

    // Ensure `user.following` is an array
    if (!Array.isArray(user.following)) {
      console.warn(`⚠️ Warning: user.following is not an array for user ${user._id}`);
      user.following = [];
    }

    const isFollowing = user.following.includes(userToFollow._id.toString());

    if (isFollowing) {
      // ✅ Unfollow Logic
      await Promise.all([
        User.findByIdAndUpdate(user._id, { $pull: { following: userToFollow._id } }).exec(),
        User.findByIdAndUpdate(userToFollow._id, { $pull: { followers: user._id } }).exec(),
        Notification.findOneAndDelete({
          userId: userToFollow._id,
          senderId: user._id,
          type: "follow",
        }).exec(),
      ]);

      req.flash("success", `You have unfollowed ${userToFollow.fullName}.`);
      console.log(`✅ ${user.fullName} unfollowed ${userToFollow.fullName}`);
    } else {
      // ✅ Follow Logic
      await Promise.all([
        User.findByIdAndUpdate(user._id, { $addToSet: { following: userToFollow._id } }).exec(),
        User.findByIdAndUpdate(userToFollow._id, { $addToSet: { followers: user._id } }).exec(),
      ]);

      // 🔔 Create a follow notification
      const notification = new Notification({
        userId: userToFollow._id,
        senderId: user._id,
        type: "follow",
        message: `${user.fullName} started following you.`,
        createdAt: new Date(),
        read: false,
      });

      await notification.save();

      // 📢 Emit real-time notification only if `io` is defined
      if (typeof io !== "undefined") {
        io.to(userToFollow._id.toString()).emit("new-notification", {
          message: `${user.fullName} started following you.`,
        });
      } else {
        console.warn("⚠️ Warning: Socket.io is not initialized.");
      }

      req.flash("success", `You are now following ${userToFollow.fullName}!`);
      console.log(`✅ ${user.fullName} started following ${userToFollow.fullName}`);
    }

    return res.redirect("back");
  } catch (err) {
    console.error("❌ Follow Error:", err);
    req.flash("error", "Something went wrong. Please try again!");
    return res.redirect("back");
  }
});

router.get("/signin", (req, res) => {
  return res.render("signin");
});

router.post("/signin", async (req, res) => {
  let { email, passward } = req.body;

  try {
    const token = await User.matchPasswardAndGenerateToken(email, passward);

    // console.log("🟢 Token generated:");

    res.cookie("token", token,{
      httpOnly: true,  
      secure: false,   
      sameSite: "Lax", 
      path: "/",       
      maxAge: 86400 * 1000, 
    });

    // console.log("🟢 Cookie being set:");
    // console.log("🟢 Response headers:", res.getHeaders());    
    return res.redirect("/");
  } catch (error) {
    console.error("❌ Error during sign-in:", error);
    return res.status(401).render("signin", { error: "Invalid Email or Password" });
  }
});

router.get("/signup", (req, res) => {
  return res.render("signup");
});

router.post("/signup", async (req, res) => {
  const { fullName, email, passward } = req.body;

  // Generate a random avatar for the user
  const avatarUrl = `https://api.dicebear.com/8.x/bottts/svg?seed=${encodeURIComponent(email)}`;

  await User.create({
    fullName,
    email,
    passward,
    profilePic: avatarUrl,
  });

  return res.redirect("/");
});

router.get("/logout", (req, res) => {
  return res.clearCookie("token").redirect("/");
});

module.exports = router;
