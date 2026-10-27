const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// LIST items, with optional filters: ?category=1&q=camera&location=hostel&available=true
router.get("/", async (req, res) => {
  const { category, q, location, available } = req.query;
  const where = [];
  const values = [];

  if (category) {
    values.push(category);
    where.push(`i.category_id = $${values.length}`);
  }
  if (q) {
    values.push(`%${q}%`);
    where.push(`(i.title ILIKE $${values.length} OR i.description ILIKE $${values.length})`);
  }
  if (location) {
    values.push(`%${location}%`);
    where.push(`i.location ILIKE $${values.length}`);
  }
  if (available === "true") {
    where.push("i.is_available = true");
  }

  const sql = `
    SELECT i.id, i.title, i.item_condition, i.location, i.deposit_amount,
           i.max_days, i.is_available, c.name AS category,
           u.name AS owner_name, u.trust_score AS owner_trust,
           (SELECT image_url FROM item_images WHERE item_id = i.id ORDER BY id LIMIT 1) AS image_url
    FROM items i
    JOIN categories c ON c.id = i.category_id
    JOIN users u ON u.id = i.owner_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY i.created_at DESC
    LIMIT 100`;

  try {
    const result = await pool.query(sql, values);
    res.json({ items: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// MY LISTINGS (this must stay above "/:id")
router.get("/mine", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT i.id, i.title, i.is_available, c.name AS category, i.created_at
       FROM items i JOIN categories c ON c.id = i.category_id
       WHERE i.owner_id = $1 ORDER BY i.created_at DESC`,
      [req.user.id]
    );
    res.json({ items: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// ONE item, with images and owner details
router.get("/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT i.*, c.name AS category, u.name AS owner_name,
              u.trust_score AS owner_trust, u.is_verified AS owner_verified
       FROM items i
       JOIN categories c ON c.id = i.category_id
       JOIN users u ON u.id = i.owner_id
       WHERE i.id = $1`,
      [req.params.id]
    );
    const item = result.rows[0];
    if (!item) return res.status(404).json({ error: "Item not found" });

    const images = await pool.query(
      "SELECT image_url FROM item_images WHERE item_id = $1 ORDER BY id",
      [item.id]
    );
    item.images = images.rows.map((r) => r.image_url);
    res.json({ item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// ADD an item (logged-in users only)
router.post("/", requireAuth, async (req, res) => {
  const { title, description, category_id, item_condition, location,
          deposit_amount, max_days, image_urls } = req.body;

  if (!title || !category_id) {
    return res.status(400).json({ error: "Title and category are required" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO items (owner_id, category_id, title, description,
                          item_condition, location, deposit_amount, max_days)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'Good'), $6, COALESCE($7, 0), COALESCE($8, 7))
       RETURNING *`,
      [req.user.id, category_id, title, description || null,
       item_condition || null, location || null,
       deposit_amount ?? null, max_days ?? null]
    );
    const item = result.rows[0];

    for (const url of image_urls || []) {
      await pool.query("INSERT INTO item_images (item_id, image_url) VALUES ($1, $2)", [item.id, url]);
    }
    res.status(201).json({ item });
  } catch (err) {
    if (err.code === "23503") {
      return res.status(400).json({ error: "That category does not exist" });
    }
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// EDIT an item (owner only)
router.put("/:id", requireAuth, async (req, res) => {
  const { title, description, category_id, item_condition, location,
          deposit_amount, max_days, is_available } = req.body;

  try {
    const result = await pool.query(
      `UPDATE items SET
         title = COALESCE($1, title),
         description = COALESCE($2, description),
         category_id = COALESCE($3, category_id),
         item_condition = COALESCE($4, item_condition),
         location = COALESCE($5, location),
         deposit_amount = COALESCE($6, deposit_amount),
         max_days = COALESCE($7, max_days),
         is_available = COALESCE($8, is_available)
       WHERE id = $9 AND owner_id = $10
       RETURNING *`,
      [title ?? null, description ?? null, category_id ?? null,
       item_condition ?? null, location ?? null, deposit_amount ?? null,
       max_days ?? null, is_available ?? null, req.params.id, req.user.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: "Item not found, or it is not yours" });
    }
    res.json({ item: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// DELETE an item (owner, or admin)
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const result =
      req.user.role === "admin"
        ? await pool.query("DELETE FROM items WHERE id = $1 RETURNING id", [req.params.id])
        : await pool.query("DELETE FROM items WHERE id = $1 AND owner_id = $2 RETURNING id",
                           [req.params.id, req.user.id]);
    if (!result.rows[0]) {
      return res.status(404).json({ error: "Item not found, or it is not yours" });
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

module.exports = router;