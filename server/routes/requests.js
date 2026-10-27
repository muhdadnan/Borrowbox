const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const DATES = `to_char(br.start_date, 'YYYY-MM-DD') AS start_date,
               to_char(br.return_date, 'YYYY-MM-DD') AS return_date`;

// SEND a borrow request
router.post("/", requireAuth, async (req, res) => {
  const { item_id, start_date, return_date, purpose } = req.body;

  if (!item_id || !start_date || !return_date) {
    return res.status(400).json({ error: "Item, start date and return date are required" });
  }
  if (!DATE_RE.test(start_date) || !DATE_RE.test(return_date)) {
    return res.status(400).json({ error: "Dates must look like 2026-11-05" });
  }

  const today = new Date().toISOString().slice(0, 10);
  if (start_date < today) {
    return res.status(400).json({ error: "Start date cannot be in the past" });
  }
  if (return_date < start_date) {
    return res.status(400).json({ error: "Return date cannot be before the start date" });
  }

  const days = Math.round((Date.parse(return_date) - Date.parse(start_date)) / 86400000) + 1;

  try {
    const itemResult = await pool.query("SELECT * FROM items WHERE id = $1", [item_id]);
    const item = itemResult.rows[0];

    if (!item) return res.status(404).json({ error: "Item not found" });
    if (item.owner_id === req.user.id) {
      return res.status(400).json({ error: "You cannot borrow your own item" });
    }
    if (!item.is_available) {
      return res.status(400).json({ error: "This item is not available right now" });
    }
    if (days > item.max_days) {
      return res.status(400).json({ error: `This item can be borrowed for at most ${item.max_days} days` });
    }

    const clash = await pool.query(
      `SELECT 1 FROM borrow_requests
       WHERE item_id = $1 AND status IN ('approved', 'active', 'returned')
         AND start_date <= $3 AND return_date >= $2
       LIMIT 1`,
      [item_id, start_date, return_date]
    );
    if (clash.rows.length) {
      return res.status(409).json({ error: "The item is already booked for those dates" });
    }

    const result = await pool.query(
      `INSERT INTO borrow_requests (item_id, borrower_id, start_date, return_date, purpose)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, item_id, status`,
      [item_id, req.user.id, start_date, return_date, purpose || null]
    );
    res.status(201).json({ request: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// MY requests (as borrower)
router.get("/mine", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT br.id, br.status, br.purpose, ${DATES},
              i.id AS item_id, i.title AS item_title, u.name AS owner_name
       FROM borrow_requests br
       JOIN items i ON i.id = br.item_id
       JOIN users u ON u.id = i.owner_id
       WHERE br.borrower_id = $1
       ORDER BY br.created_at DESC`,
      [req.user.id]
    );
    res.json({ requests: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// INCOMING requests (as owner)
router.get("/incoming", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT br.id, br.status, br.purpose, ${DATES},
              i.id AS item_id, i.title AS item_title,
              u.id AS borrower_id, u.name AS borrower_name, u.trust_score AS borrower_trust
       FROM borrow_requests br
       JOIN items i ON i.id = br.item_id
       JOIN users u ON u.id = br.borrower_id
       WHERE i.owner_id = $1
       ORDER BY br.created_at DESC`,
      [req.user.id]
    );
    res.json({ requests: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// MOVE a request along: approve, reject, cancel, handover, return, complete
const transitions = {
  approve:  { from: "requested", to: "approved",  who: "owner" },
  reject:   { from: "requested", to: "rejected",  who: "owner" },
  cancel:   { from: "requested", to: "cancelled", who: "borrower" },
  handover: { from: "approved",  to: "active",    who: "owner" },
  return:   { from: "active",    to: "returned",  who: "borrower" },
  complete: { from: "returned",  to: "completed", who: "owner" },
};

router.put("/:id/:action", requireAuth, async (req, res) => {
  const { id, action } = req.params;
  const rule = transitions[action];

  if (!rule) return res.status(404).json({ error: "Unknown action" });
  if (!Number.isInteger(Number(id))) {
    return res.status(400).json({ error: "Invalid request id" });
  }

  try {
    const found = await pool.query(
      `SELECT br.*, to_char(br.start_date, 'YYYY-MM-DD') AS start_str,
              to_char(br.return_date, 'YYYY-MM-DD') AS return_str, i.owner_id
       FROM borrow_requests br
       JOIN items i ON i.id = br.item_id
       WHERE br.id = $1`,
      [id]
    );
    const request = found.rows[0];
    if (!request) return res.status(404).json({ error: "Request not found" });

    const isOwner = request.owner_id === req.user.id;
    const isBorrower = request.borrower_id === req.user.id;
    if ((rule.who === "owner" && !isOwner) || (rule.who === "borrower" && !isBorrower)) {
      return res.status(403).json({ error: `Only the ${rule.who} can do this` });
    }
    if (request.status !== rule.from) {
      return res.status(400).json({ error: `Cannot ${action} a request that is ${request.status}` });
    }

    if (action === "approve") {
      const clash = await pool.query(
        `SELECT 1 FROM borrow_requests
         WHERE item_id = $1 AND id <> $2 AND status IN ('approved', 'active', 'returned')
           AND start_date <= $4 AND return_date >= $3
         LIMIT 1`,
        [request.item_id, request.id, request.start_str, request.return_str]
      );
      if (clash.rows.length) {
        return res.status(409).json({ error: "Those dates are already booked by another request" });
      }
    }

    const updated = await pool.query(
      `UPDATE borrow_requests SET status = $1, updated_at = NOW()
       WHERE id = $2 RETURNING id, status`,
      [rule.to, id]
    );
    res.json({ request: updated.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

module.exports = router;