const express = require("express");
const multer = require("multer");
const cloudinary = require("../utils/cloudinary");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPG, PNG or WebP images are allowed"));
  },
});

function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder: "borrowbox",
          resource_type: "image",
          transformation: [{ width: 1200, crop: "limit", quality: "auto", fetch_format: "auto" }],
        },
        (err, result) => (err ? reject(err) : resolve(result.secure_url))
      )
      .end(buffer);
  });
}

// Upload up to 5 photos, returns their links
router.post("/", requireAuth, (req, res) => {
  upload.array("images", 5)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files || !req.files.length) {
      return res.status(400).json({ error: "Please choose at least one image" });
    }
    try {
      const urls = await Promise.all(req.files.map((f) => uploadToCloudinary(f.buffer)));
      res.status(201).json({ urls });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Image upload failed" });
    }
  });
});

module.exports = router;