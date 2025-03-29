const User = require("../models/user"); // Import your User model
const Blog = require("../models/blog"); // Import your Blog model
const mongoose = require("mongoose");


async function getProfile(req, res) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized access" });
    }

    const userId = req.user._id;

    // Count the number of blogs written by the user
    const mongoose = require("mongoose");
    const blogCount = await Blog.countDocuments({ author: new mongoose.Types.ObjectId(user._id) });

    res.render("profile", { user: req.user, blogCount });
  } catch (error) {
    console.error("❌ Error fetching profile data:", error);
    res.status(500).send("Internal Server Error");
  }
}

module.exports = { getProfile };