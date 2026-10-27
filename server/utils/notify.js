const pool = require("../db");

async function notify(userId, message, requestId = null) {
  try {
    await pool.query(
      "INSERT INTO notifications (user_id, message, request_id) VALUES ($1, $2, $3)",
      [userId, message, requestId]
    );
  } catch (err) {
    console.error("Could not save notification:", err.message);
  }
}

module.exports = { notify };