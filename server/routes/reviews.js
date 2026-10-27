const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// LEAVE a review after a completed transaction
router.post("/", requireAuth, async (req, res) => {
  const { request_id, rating, comment } = req.body;

  if (!Number.isInteger(Number(request_id))) {
    return res.status(400).json({ error: "A valid request_id is required" });
  }
  const stars = Number(rating);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return res.status(400).json({ error: "Rating must be a whole number from 1 to 5" });
  }
  if (comment && comment.length > 500) {
    return res.status(400).json({ error: "Comment must be 500 characters or fewer" });
  }

  try {
    const found = await pool.query(
      `SELECT br.id, br.status, br.borrower_id, i.owner_id
       FROM borrow_requests br
       JOIN items i ON i.id = br.item_id
       WHERE br.id = $1`,
      [request_id]
    );
    const request = found.rows[0];
    if (!request) return res.status(404).json({ error: "Request not found" });

    const isOwner = request.owner_id === req.user.id;
    const isBorrower = request.borrower_id === req.user.id;
    if (!isOwner && !isBorrower) {
      return res.status(403).json({ error: "You were not part of this transaction" });
    }
    if (request.status !== "completed") {
      return res.status(400).json({ error: "You can review only after the transaction is completed" });
    }

    const revieweeId = isOwner ? request.borrower_id : request.owner_id;

    const result = await pool.query(
      `INSERT INTO reviews (request_id, reviewer_id, reviewee_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, request_id, rating, comment`,
      [request_id, req.user.id, revieweeId, stars, comment || null]
    );

    // Trust score = average of all ratings this person has received
    await pool.query(
      `UPDATE users
       SET trust_score = (SELECT ROUND(AVG(rating), 2) FROM reviews WHERE reviewee_id = $1)
       WHERE id = $1`,
      [revieweeId]
    );

    res.status(201).json({ review: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "You have already reviewed this transaction" });
    }
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// A user's public profile summary and the reviews they have received
router.get("/user/:id", async (req, res) => {
  if (!Number.isInteger(Number(req.params.id))) {
    return res.status(400).json({ error: "Invalid user id" });
  }

  try {
    const userResult = await pool.query(
      `SELECT id, name, location, is_verified, trust_score, created_at
       FROM users WHERE id = $1`,
      [req.params.id]
    );
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: "User not found" });

    const reviews = await pool.query(
      `SELECT r.id, r.rating, r.comment, r.created_at, u.name AS reviewer_name
       FROM reviews r
       JOIN users u ON u.id = r.reviewer_id
       WHERE r.reviewee_id = $1
       ORDER BY r.created_at DESC
       LIMIT 50`,
      [req.params.id]
    );

    res.json({ user, review_count: reviews.rows.length, reviews: reviews.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

module.exports = router;