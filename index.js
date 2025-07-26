const express = require("express");
const cookieParser = require("cookie-parser");
const app = express();
const path = require("path");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const svgCaptcha = require("svg-captcha");
const mongoose = require("mongoose");
const moment = require("moment");
const flash = require("connect-flash");
const aiRoute = require("./routes/ai");
const dotenv = require("dotenv");
dotenv.config();
const socketio = require("socket.io");

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const checkForAuthenticationCookie = require("./middleware/authencation");

const Blog = require("./models/blog");
const Comment = require("./models/comment");
const User = require("./models/user");
const Notification = require("./models/Notification");

const userRoute = require("./routes/user");
const blogRoute = require("./routes/blog");
const subscriptionRoute = require("./routes/subscription");
const notificationsRoute = require("./routes/notifications");
const { ServerApiVersion } = require("mongodb");

// MongoDB Connection
const URI = process.env.MONGO_URI;
if (!URI) {
  throw new Error("❌ MONGO_URI is not defined. Please add it to your environment variables.");
}

mongoose
  .connect(URI)
  .then(() => console.log("✅ MongoDB connected successfully."))
  .catch((error) => console.error("❌ Error connecting to MongoDB:", error.message));

const port = 8000;

// View Engine Setup
app.set("view engine", "ejs");
app.set("views", path.resolve("./views"));

// Middleware

app.use(cookieParser());
app.use(checkForAuthenticationCookie("token"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.resolve("./public")));
app.use(express.static("public"));
app.use((req, res, next) => {
  res.locals.user = req.user || null;
  next();
});



// Add session store error handling
const sessionStore = MongoStore.create({
  mongoUrl: URI,
  ttl: 24 * 60 * 60,
  crypto: {
    secret: process.env.SESSION_SECRET || 'your-secret-key'
  },
  autoRemove: 'native',
  touchAfter: 24 * 3600
});

sessionStore.on('error', function(error) {
  console.error('Session Store Error:', error);
});

// Session Configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: true,
    store: sessionStore
  })
);

app.use(flash());
app.use((req, res, next) => {
  res.locals.success_msg = req.flash("success");
  res.locals.error_msg = req.flash("error");
  next();
});

app.get('/user/edit-profile', (req, res) => {
  res.render('editprofile', {
    user: req.user,  // Assuming you have the user data available
    messages: req.flash()  // Pass flash messages to the EJS view
  });
});




app.get("/main", async (req, res) => {
  try {
    const blogs = await Blog.find()
      .sort({ createdAt: -1 })
      .populate("createdBy", "fullName");

    // ✅ Fix: Use "featured" instead of "isFeatured"
    const featuredBlogs = await Blog.find({ featured: true }) 
      .sort({ createdAt: -1 })
      .populate("createdBy", "fullName");

    const trendingBlogs = await Blog.find()
      .sort({ views: -1 })
      .limit(3)
      .populate("createdBy", "fullName");

    res.render("main", { blogs, featuredBlogs, trendingBlogs, searchQuery: "", moment });

  } catch (error) {
    console.error("❌ Error fetching blogs:", error);
    res.status(500).send("Server error");
  }
});




// Home Route with Search & Filtering
app.get("/", async (req, res) => {
  try {
    // Get search and filter values from the query parameters
    const searchQuery = req.query.searchQuery || ""; // Default to empty string
    const categoryFilter = req.query.category ? req.query.category.toLowerCase() : "";
    const tagFilter = req.query.tag ? req.query.tag.toLowerCase() : "";

    let filter = {};
    let sort = {};

    // Apply search query filter if provided
    if (searchQuery) {
      filter.$text = { $search: searchQuery }; // MongoDB full-text search
      sort = { score: { $meta: "textScore" } }; // Sort by text relevance
    }

    // Apply category filter (case-insensitive)
    if (categoryFilter) {
      filter.category = { $regex: new RegExp(categoryFilter, "i") };
    }

    // Apply tag filter (case-insensitive)
    if (tagFilter) {
      filter.tags = { $in: [new RegExp(tagFilter, "i")] };
    }

    // Fetch blogs based on filters and search
    const blogs = await Blog.find(filter).sort(sort);
    const categories = await Blog.distinct("category");
    const tags = await Blog.distinct("tags");

    // Fetch featured and trending blogs
    const featuredBlogs = await Blog.find({ featured: true }).limit(5);
    const trendingBlogs = await Blog.find().sort({ views: -1 }).limit(3);


    // Render the home page
    res.render("home", {
      user: req.user || null, // Ensure user is always passed
      blogs: blogs || [], // Ensure blogs array is always defined
      featuredBlogs,
      trendingBlogs,
      categories,
      tags,
      searchQuery, // Search query for input field
      categoryFilter,
      tagFilter,
      moment, // Moment.js for date formatting
    });
  } catch (err) {
    console.error("❌ Error fetching blogs:", err.message);
    res.status(500).render("error", { message: "An error occurred while fetching blogs." });
  }
});


 // Socket.io

 const http = require("http"); // Import http module
 const socketIo = require("socket.io");

 const server = http.createServer(app); // Create HTTP server
 const io = socketIo(server); // Create Socket.io server

 app.set("io", io);

 // WebSocket connections
 const users = {};
 io.on("connection", (socket) => {
     console.log("🟢 User connected:", socket.id);
 
     socket.on("register", (userId) => {
         users[userId] = socket.id;
         console.log(`✅ User ${userId} mapped to socket ${socket.id}`);
     });
 
     socket.on("disconnect", () => {
         console.log("🔴 User disconnected:", socket.id);
         for (let userId in users) {
             if (users[userId] === socket.id) {
                 delete users[userId];
                 break;
             }
         }
     });
 });
module.exports = { io };



// CAPTCHA Route
app.get("/captcha", (req, res) => {
  const captcha = svgCaptcha.create({
    size: 5,
    noise: 1,
    color: true,
    background: "#f0f0f0",
    width: 150,
    height: 50,
    fontSize: 50,
    charPreset: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  });

  req.session.captcha = captcha.text;
  res.type("svg").send(captcha.data);
});

// CAPTCHA Verification
app.post("/verify-captcha", (req, res) => {
  if (!req.session.captcha) {
    return res.status(400).json({ error: "⚠️ CAPTCHA expired. Please reload!" });
  }

  if (req.body.captcha !== req.session.captcha) {
    return res.status(400).json({ error: "❌ CAPTCHA Incorrect. Try Again!" });
  }

  req.session.captcha = null; // Clear after success
  res.json({ success: "✅ CAPTCHA Verified Successfully!" });
});

// Routes
app.use("/user", userRoute);
app.use("/blog", blogRoute);
app.use("/subscription", subscriptionRoute);
app.use("/notifications", notificationsRoute);
app.use("/ai", aiRoute);


// 404 Page
app.get("*", (req, res) => {
  res.render("404");
  res.status(404);
});

// Start Server
app.listen(port, () => console.log(`🚀 App listening on port ${port}`));