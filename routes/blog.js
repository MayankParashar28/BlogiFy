const { Router } = require("express");
const multer = require("multer");
const path = require("path");
const moment = require("moment"); // Ensure moment is imported
const User = require("../models/user");
const Comment = require("../models/comment");
const Blog = require("../models/blog");
const marked = require("marked");
const { checkSubscription } = require("../middleware/subscription");
const { generateBlogWithAI } = require("../utils/aiHelper");
const { error } = require("console");
const Notification = require("../models/Notification");
const { response } = require("express");
const authencation = "../Services/authencation.js"
const dotenv = require("dotenv");
dotenv.config(); 

const router = Router();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.resolve("./public/uploads"));
  },
  filename: function (req, file, cb) {
    const fileName = `${Date.now()}-${file.originalname}`;
    cb(null, fileName);
  },
});

const upload = multer({ storage: storage });

 // 📝 Create a Blog
router.get("/add-new", (req, res) => {
  return res.render("addBlog", {
    user: req.user || null, // ✅ Prevents crashes if user is undefined
    
    searchQuery: req.query.search || "", // ✅ Prevents EJS errors
  });
});

//  show blog
router.get("/:id", async (req, res) => {
  try {
    // Fetch the blog and ensure `createdBy` is populated
    const blog = await Blog.findById(req.params.id).populate("createdBy", "fullName profilePic");

    if (!blog) {
      return res.status(404).render("error", { message: "Blog not found." });
    }

    // Ensure `createdBy` exists
    if (!blog.createdBy) {
      console.error("❌ Error: blog.createdBy is undefined!");
      return res.status(500).render("error", { message: "Blog creator not found." });
    }

    // Increase view count
    blog.views += 1;
    await blog.save();

    // Fetch comments
    const comments = await Comment.find({ blogId: req.params.id })
      .populate("createdBy", "fullName profilePic")
      .lean() || [];

    // Check if the blog is bookmarked by the user
    let isBookmarked = false;
    if (req.user) {
      const user = await User.findById(req.user._id);
      if (user && user.bookmarks.includes(req.params.id)) {
        isBookmarked = true;
      }
    }

    return res.render("blog", {
      user: req.user || null,
      blog,
      comments,
      isAuthenticated: !!req.user,
      searchQuery: "",
      moment,
      createdByName: blog.createdBy.fullName || "Unknown",
      createdByProfilePic: blog.createdBy.profilePic || "/default-profile.png",
      formattedDate: moment(blog.createdAt).format("dddd, MMMM Do YYYY, h:mm A"),
      isBookmarked, // Pass bookmark status to EJS
    });
  } catch (err) {
    console.error("❌ Error fetching blog:", err.message);
    return res.status(500).render("error", { message: "An error occurred while fetching the blog." });
  }
});

//bookmark a blog
router.post("/bookmark/:blogId", async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    const user = await User.findById(req.user._id);
    const blogId = req.params.blogId;

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (user.bookmarks.includes(blogId)) {
      user.bookmarks = user.bookmarks.filter(id => id.toString() !== blogId);
      await user.save();
      return res.json({ success: true, bookmarked: false });
    } else {
      user.bookmarks.push(blogId);
      await user.save();
      return res.json({ success: true, bookmarked: true });
    }
  } catch (error) {
    console.error("❌ Bookmarking Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Like or Dislike a Blog Post
router.post("/like/:blogId", async (req, res) => {
  if (!req.user) {
    if (req.headers.accept && req.headers.accept.includes("text/html")) {
      return res.redirect("/login");
    }
    return res.status(401).json({ success: false, message: "Please log in to like a blog." });
  }

  try {
    const blog = await Blog.findById(req.params.blogId).populate("createdBy");
    if (!blog) return res.status(404).json({ success: false, message: "Blog not found" });

    const userId = req.user._id.toString();
    const likedIndex = blog.likedBy.indexOf(userId);
    const isNewLike = likedIndex === -1;

    // Toggle like
    isNewLike ? blog.likedBy.push(userId) : blog.likedBy.splice(likedIndex, 1);
    blog.likes = blog.likedBy.length;
    await blog.save();

    // Send notification if another user liked/unliked
    if (isNewLike && blog.createdBy && blog.createdBy._id.toString() !== userId) {
      await Notification.create({
        userId: blog.createdBy._id.toString(),
        senderId: userId,
        message: `${req.user.fullName} ${isNewLike ? "liked" : "unliked"} your blog.`,
        type: "like",
        read: false,
        createdAt: new Date(),
      });
    }

    res.json({ success: true, liked: isNewLike, likes: blog.likes });

  } catch (error) {
    console.error("❌ Error in liking blog:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Comment on a Blog
router.post("/comment/:blogId", async (req, res) => {
  const COMMENT_COOLDOWN = 5 * 60 * 1000; // 5 minutes in milliseconds
  try {
    const blog = await Blog.findById(req.params.blogId);
    if (!blog) {
      req.flash("error", "Blog not found.");
      return res.redirect("back");
    }

    const userId = req.user._id;

    // ✅ Check last comment time of this user
    const lastComment = await Comment.findOne({ createdBy: userId })
      .sort({ createdAt: -1 }) // Get the latest comment
      .select("createdAt");

    if (lastComment) {
      const timeSinceLastComment = new Date() - new Date(lastComment.createdAt);
      if (timeSinceLastComment < COMMENT_COOLDOWN) {
        req.flash("error", `Please wait ${Math.ceil((COMMENT_COOLDOWN - timeSinceLastComment) / 60000)}m before commenting again.`);
        return res.redirect(`/blog/${req.params.blogId}`);
      }
    }

    // ✅ Create the comment
    const comment = await Comment.create({
      content: req.body.content,
      blogId: req.params.blogId,
      createdBy: userId,
      createdAt: new Date(),
    });

    // ✅ Send Notification (if not the owner commenting)
    if (blog.createdBy.toString() !== userId.toString()) {
      await Notification.create({
        userId: blog.createdBy, // Blog owner's ID
        senderId: userId, // Commenter's ID
        message: `${req.user.fullName} commented ${comment.content ? `: "${comment.content}"` : ""} on your blog.`,
        type: "comment",
        read: false,
        createdAt: new Date(),
      });
    }

    req.flash("success", "Comment added successfully!");
    return res.redirect(`/blog/${req.params.blogId}`);
  } catch (error) {
    console.error("❌ Error adding comment:", error.message);
    req.flash("error", "Something went wrong. Try again.");
    return res.redirect("back");
  }
});

// Delete a Blog Post
router.post("/delete/:blogId", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const blog = await Blog.findById(req.params.blogId);
    if (!blog) {
      return res.status(404).json({ success: false, message: "Blog not found" });
    }

    if (blog.createdBy.toString() !== req.user._id.toString()) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    await blog.deleteOne();
    return res.redirect("/");
  } catch (error) {
    console.error("❌ Error deleting blog:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Category for Blogs
router.get("/category/:category", async (req, res) => {
  const category = req.params.category;
  const blogs = await Blog.find({ category });
  return res.render("home", { user: req.user, blogs });
});

// Tag for Blogs
router.get("/tag/:tag", async (req, res) => {
  const tag = req.params.tag;
  const blogs = await Blog.find({ tags: tag });
  return res.render("home", { user: req.user, blogs });
});

// 🔥 Fetch Featured Blogs
router.get("/featured", async (req, res) => {
  const featuredBlogs = await Blog.find({ featured: true });
  console.log(featuredBlogs); // Debugging: Check if blogs are fetched  console.log("Featured Blogs:", featuredBlogs); // Debugging
  return res.render("home", { user: req.user, blogs: featuredBlogs });
});

// 🚀 Fetch Trending Blogs (Most Viewed)
router.get("/trending", async (req, res) => {
  const trendingBlogs = await Blog.find().sort({ views: -1 }).limit(3);
  return res.render("home", { user: req.user, blogs: trendingBlogs });
});

// 📝 Create a Blog
router.post("/", upload.single("coverImage"), async (req, res) => {
  const BLOG_COOLDOWN = 10 * 60 * 1000; // 10 minutes in milliseconds
  try {
    const { title, body, category, tags, useAI } = req.body;

    if (!req.user) {
      console.log("❌ Unauthorized User");
      return res.status(401).send("Unauthorized: Please log in first.");
    }

    // ✅ Check last blog post time of this user
    const lastBlog = await Blog.findOne({ createdBy: req.user._id })
      .sort({ createdAt: -1 }) // Get the latest blog
      .select("createdAt");

    if (lastBlog) {
      const timeSinceLastBlog = new Date() - new Date(lastBlog.createdAt);
      if (timeSinceLastBlog < BLOG_COOLDOWN) {
        const remainingTime = Math.ceil((BLOG_COOLDOWN - timeSinceLastBlog) / 60000); // Convert to minutes
        req.flash("error", `Please wait ${remainingTime} minutes before posting another blog.`);
        return res.redirect("/");
      }
    }

    if (!title || !category) {
      console.log("❌ Missing Title or Category");
      return res.status(400).send("Title and Category are required.");
    }

    const tagArray = tags ? tags.split(",").map(tag => tag.trim()) : [];
    if (tagArray.length === 0) {
      console.log("❌ No Tags Provided");
      return res.status(400).send("At least one tag is required.");
    }

    if (!req.file) {
      console.log("❌ No Cover Image Uploaded");
      return res.status(400).send("No cover image uploaded.");
    }

    let finalBody = body?.trim() || "";

    console.log("🤖 AI Requested:", useAI);
    if (useAI === "true" && finalBody.length === 0) {
      console.log("🤖 AI Generating Full Blog...");

      const isSubscribed = await checkSubscription(req.user._id);
      if (!isSubscribed) {
        console.log("❌ User Not Subscribed. Redirecting...");
        return res.redirect("/subscribe");
      }

      try {
        finalBody = await generateBlogWithAI(title, "");
        console.log("✅ AI Generated Full Blog");
      } catch (aiError) {
        console.error("❌ AI Error:", aiError);
        return res.status(500).send("AI failed to generate content. Try again.");
      }
    } else if (useAI === "true") {
      console.log("🤖 AI Expanding Existing Content...");
      try {
        finalBody = await generateBlogWithAI(title, finalBody);
        console.log("✅ AI Expanded Content");
      } catch (aiError) {
        console.error("❌ AI Expansion Error:", aiError);
        return res.status(500).send("AI failed to generate content. Try again.");
      }
    }

    if (!finalBody || finalBody.trim().length === 0) {
      console.log("❌ Final Body Still Empty!");
      return res.status(400).send("Blog content is required.");
    }

    // ✅ Save Blog in Database
    const blog = await Blog.create({
      title,
      body: finalBody,
      category,
      tags: tagArray,
      createdBy: req.user._id,
      coverImageURL: `/uploads/${req.file.filename}`,
      createdAt: new Date(), // Ensure createdAt timestamp is set
    });

    // ✅ Save Notification for Blog Owner
    const selfNotification = new Notification({
      userId: req.user._id, // User receiving notification
      senderId: req.user._id, // The uploader
      type: "blog_upload",
      message: `You successfully uploaded a new blog: "${title}"`,
      read: false,  // Mark notification as unread initially
      createdAt: new Date(),
    });
    await selfNotification.save();

    // ✅ Notify All Followers
    const user = await User.findById(req.user._id).populate("followers");
    if (!user || !user.fullName) {
      console.error("❌ User not found or missing name field.");
      return res.status(500).send("User data is incomplete.");
    }

    const followerNotifications = user.followers.map((follower) => ({
      userId: follower._id, // Follower receiving the notification
      senderId: req.user._id, // User who uploaded the blog
      type: "blog_upload",
      message: `${user.fullName} uploaded a new blog: "${title}"`,
      read: false,
      createdAt: new Date(),
    }));

    await Notification.insertMany(followerNotifications);

    return res.redirect("/");
  } catch (error) {
    console.error("❌ Server Error:", error);
    res.status(500).send("Internal Server Error");
  }
});

// AI Blog Generation
// router.post("/generate-ai", async (req, res) => {
//   try {
//       const { userId, title, body } = req.body;
      
//       // 🔍 Find the user in the database
//       const user = await User.findById(userId);

//       // 🚨 Check if user is subscribed
//       if (!user || !user.isSubscribed) {
//           return res.status(403).json({ error: "You need a subscription to generate AI blogs." });
//       }

//       // 🎯 AI Blog Generation Logic (Modify API accordingly)
//       const aiResponse = await fetch("YOUR_AI_API_ENDPOINT", {
//           method: "POST",
//           headers: { 
//               "Content-Type": "application/json",
//               "Authorization": `Bearer YOUR_HUGGINGFACE_API_KEY`
//           },
//           body: JSON.stringify({ title, body }),
//       });

//       const data = await aiResponse.json();

//       if (!aiResponse.ok) {
//           return res.status(500).json({ error: "AI generation failed." });
//       }

//       res.json({ generatedContent: data.generatedContent, wordCount: data.wordCount });

//   } catch (error) {
//       console.error("🔥 AI Generation Error:", error);
//       res.status(500).json({ error: "Something went wrong while generating the blog." });
//   }
// });

module.exports = router;