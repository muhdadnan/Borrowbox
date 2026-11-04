const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { notify } = require("../utils/notify");

const router = express.Router();

const READABLE = ["approved", "active", "returned", "completed"];
const WRITABLE = ["approved", "active", "returned"];

// Loads the request if this user is its borrower or the item's owner
async function getChat(requestId, userId) {
  const result = await pool.query(
    `SELECT br.id, br.status, br.borrower_id, i.owner_id, i.title AS item_title
     FROM borrow_requests br
     JOIN items i ON i.id = br.item_id
     WHERE br.id = $1`,
    [requestId]
  );
  const chat = result.rows[0];
  if (!chat) return null;
  if (chat.borrower_id !== userId && chat.owner_id !== userId) return null;
  return chat;
}

// MY chats: requests that have been approved (newest activity first)
router.get("/", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM (
         SELECT br.id AS request_id, br.status, br.updated_at, i.title AS item_title,
                CASE WHEN br.borrower_id = $1 THEN o.name ELSE b.name END AS other_name,
                (SELECT body FROM messages WHERE request_id = br.id ORDER BY id DESC LIMIT 1) AS last_message,
                (SELECT created_at FROM messages WHERE request_id = br.id ORDER BY id DESC LIMIT 1) AS last_at,
                (SELECT COUNT(*)::int FROM messages
                 WHERE request_id = br.id AND sender_id <> $1 AND read_at IS NULL) AS unread
         FROM borrow_requests br
         JOIN items i ON i.id = br.item_id
         JOIN users o ON o.id = i.owner_id
         JOIN users b ON b.id = br.borrower_id
         WHERE (br.borrower_id = $1 OR i.owner_id = $1)
           AND br.status = ANY($2)
       ) t
       ORDER BY COALESCE(t.last_at, t.updated_at) DESC`,
      [req.user.id, READABLE]
    );
    const total = result.rows.reduce((sum, row) => sum + row.unread, 0);
    res.json({ unread_total: total, chats: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// READ messages (use ?after=<last message id> to get only new ones)
router.get("/:requestId/messages", requireAuth, async (req, res) => {
  const requestId = Number(req.params.requestId);
  if (!Number.isInteger(requestId)) return res.status(400).json({ error: "Invalid request id" });
  const after = Number(req.query.after) || 0;

  try {
    const chat = await getChat(requestId, req.user.id);
    if (!chat) return res.status(404).json({ error: "Chat not found" });
    if (!READABLE.includes(chat.status)) {
      return res.status(403).json({ error: "Chat opens after the owner approves the request" });
    }

    const otherId = chat.borrower_id === req.user.id ? chat.owner_id : chat.borrower_id;
    const other = await pool.query("SELECT name FROM users WHERE id = $1", [otherId]);

    const messages = await pool.query(
      `SELECT id, sender_id, body, created_at FROM messages
       WHERE request_id = $1 AND id > $2
       ORDER BY id LIMIT 200`,
      [requestId, after]
    );
    await pool.query(
      `UPDATE messages SET read_at = NOW()
       WHERE request_id = $1 AND sender_id <> $2 AND read_at IS NULL`,
      [requestId, req.user.id]
    );

    res.json({
      chat: {
        request_id: chat.id,
        status: chat.status,
        item_title: chat.item_title,
        other_name: other.rows[0]?.name || "User",
        can_send: WRITABLE.includes(chat.status),
      },
      messages: messages.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// SEND a message
router.post("/:requestId/messages", requireAuth, async (req, res) => {
  const requestId = Number(req.params.requestId);
  if (!Number.isInteger(requestId)) return res.status(400).json({ error: "Invalid request id" });

  const body = String(req.body.body || "").trim();
  if (!body) return res.status(400).json({ error: "Message cannot be empty" });
  if (body.length > 1000) {
    return res.status(400).json({ error: "Message must be 1000 characters or fewer" });
  }

  try {
    const chat = await getChat(requestId, req.user.id);
    if (!chat) return res.status(404).json({ error: "Chat not found" });
    if (!WRITABLE.includes(chat.status)) {
      return res.status(403).json({
        error:
          chat.status === "completed"
            ? "This transaction is finished, so the chat is read-only"
            : "Chat opens after the owner approves the request",
      });
    }

    const otherId = chat.borrower_id === req.user.id ? chat.owner_id : chat.borrower_id;

    // Only notify when I have no earlier unread message waiting for them
    const pending = await pool.query(
      `SELECT 1 FROM messages
       WHERE request_id = $1 AND sender_id = $2 AND read_at IS NULL LIMIT 1`,
      [requestId, req.user.id]
    );

    const inserted = await pool.query(
      `INSERT INTO messages (request_id, sender_id, body)
       VALUES ($1, $2, $3) RETURNING id, sender_id, body, created_at`,
      [requestId, req.user.id, body]
    );

    if (!pending.rows.length) {
      await notify(otherId, `New message about "${chat.item_title}"`, requestId);
    }
    res.status(201).json({ message: inserted.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

module.exports = router;