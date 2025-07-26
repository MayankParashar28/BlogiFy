// /routes/ai.js
const express = require("express");
const router = express.Router();
const fetch = require("node-fetch"); // or use native fetch in Node 18+

const GOOGLE_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;

router.post("/generate-blog", async (req, res) => {
  const { title } = req.body;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Write a 600-word blog post on: "${title}"` }] }]
      })
    });

    const data = await response.json();
    console.log("Gemini response:", JSON.stringify(data, null, 2));
    if (data.error) {
      console.error("Gemini API Error:", data.error);
      return res.status(500).json({ content: `❌ Gemini API Error: ${data.error.message}` });
    }
    const content = data.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "No blog content generated.";
    res.json({ content });
  } catch (err) {
    console.error("❌ Gemini API Error:", err);
    res.status(500).json({ error: "AI generation failed." });
  }
});

module.exports = router;