const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 8080;

// ======================================
// DATABASE SETTINGS
// ======================================

const DB_CONFIG = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  port: Number(process.env.DB_PORT) || 3306
};

const DB_NAME = process.env.DB_NAME || "shepherd_ministry_db";

// Will be assigned inside startServer() after the database exists
let db;

// ======================================
// MIDDLEWARE
// ======================================

app.use(cors());
app.use(express.json());

// ======================================
// AUTO-CREATE DATABASE AND TABLES
// ======================================

// Adds a column only if it does not exist yet (never deletes data)
async function ensureColumn(table, column, definition) {
  const [rows] = await db.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [DB_NAME, table, column]
  );

  if (rows.length === 0) {
    await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    console.log(`Added missing column: ${table}.${column}`);
  }
}

// Reads the real column info of a table
async function getColumns(table) {
  const [rows] = await db.query(
    `SELECT
       COLUMN_NAME AS name,
       DATA_TYPE AS dataType,
       COLUMN_TYPE AS columnType,
       IS_NULLABLE AS nullable,
       COLUMN_DEFAULT AS defaultValue,
       EXTRA AS extra,
       COLUMN_KEY AS columnKey
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [DB_NAME, table]
  );
  return rows;
}

// Makes an OLD / DIFFERENT "messages" table compatible with this server.
// It only changes column definitions. It never deletes rows or columns.
async function repairMessagesTable() {
  const textTypes = ["varchar", "char", "tinytext", "text", "mediumtext", "longtext"];
  const bigTextTypes = ["text", "mediumtext", "longtext"];
  const dateTypes = ["datetime", "timestamp", "date"];
  const knownColumns = ["id", "userid", "name", "message", "reply", "date"];

  async function tryAlter(label, sql) {
    try {
      await db.query(sql);
      console.log("REPAIRED messages table:", label);
    } catch (err) {
      console.warn("COULD NOT REPAIR messages table:", label, "-", err.sqlMessage || err.message);
    }
  }

  let cols = await getColumns("messages");
  const find = (n) => cols.find((c) => c.name.toLowerCase() === n.toLowerCase());

  // id must be an auto-increment primary key
  const idCol = find("id");
  if (!idCol) {
    await tryAlter("added id column", "ALTER TABLE `messages` ADD COLUMN `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST");
  } else if (!/auto_increment/i.test(idCol.extra)) {
    if (idCol.columnKey === "PRI") {
      await tryAlter("id is now AUTO_INCREMENT", "ALTER TABLE `messages` MODIFY `id` INT NOT NULL AUTO_INCREMENT");
    } else {
      await tryAlter("id is now AUTO_INCREMENT PRIMARY KEY", "ALTER TABLE `messages` MODIFY `id` INT NOT NULL AUTO_INCREMENT, ADD PRIMARY KEY (`id`)");
    }
  }

  // userId must accept any text (e.g. "user_12", an email, or a number)
  const userIdCol = find("userId");
  if (userIdCol && !textTypes.includes(userIdCol.dataType)) {
    await tryAlter("userId is now VARCHAR(100)", "ALTER TABLE `messages` MODIFY `userId` VARCHAR(100) NOT NULL DEFAULT ''");
  }

  // name must be text
  const nameCol = find("name");
  if (nameCol && !textTypes.includes(nameCol.dataType)) {
    await tryAlter("name is now VARCHAR(100)", "ALTER TABLE `messages` MODIFY `name` VARCHAR(100) NULL DEFAULT 'Member'");
  }

  // message and reply must be long text (not a short VARCHAR)
  for (const field of ["message", "reply"]) {
    const col = find(field);
    if (col && !bigTextTypes.includes(col.dataType)) {
      await tryAlter(`${field} is now TEXT`, `ALTER TABLE \`messages\` MODIFY \`${field}\` TEXT NULL`);
    }
  }

  // date must be a real date/time or text
  const dateCol = find("date");
  if (dateCol && !dateTypes.includes(dateCol.dataType) && !textTypes.includes(dateCol.dataType)) {
    await tryAlter("date is now DATETIME", "ALTER TABLE `messages` MODIFY `date` DATETIME NULL DEFAULT CURRENT_TIMESTAMP");
  }

  // Any EXTRA column that is required (NOT NULL, no default) would make every
  // insert fail, so make those optional.
  cols = await getColumns("messages");
  for (const c of cols) {
    const isKnown = knownColumns.includes(c.name.toLowerCase());
    const isAuto = /auto_increment/i.test(c.extra);
    const isGenerated = /generated/i.test(c.extra);
    if (!isKnown && !isAuto && !isGenerated && c.nullable === "NO" && c.defaultValue === null) {
      await tryAlter(
        `extra column "${c.name}" is now optional`,
        `ALTER TABLE \`messages\` MODIFY \`${c.name}\` ${c.columnType} NULL`
      );
    }
  }
}

// Really tests saving a message, a reply, and a bible verse, then removes the test rows.
async function runSelfTest() {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [msg] = await conn.query(
      `INSERT INTO messages (userId, name, message, date)
       VALUES (?, ?, ?, NOW())`,
      ["__selftest__", "Self Test", "Self test message"]
    );

    await conn.query("UPDATE messages SET reply = ? WHERE id = ?", [
      "Self test reply",
      msg.insertId
    ]);

    const [rows] = await conn.query(
      `SELECT id, userId, name, message, reply, date
       FROM messages WHERE id = ?`,
      [msg.insertId]
    );

    if (rows.length !== 1 || rows[0].message !== "Self test message" || rows[0].reply !== "Self test reply") {
      throw new Error("Message or reply was not stored correctly.");
    }

    const [verse] = await conn.query(
      `INSERT INTO bible_verses (verse_text, reference_text)
       VALUES (?, ?)`,
      ["Self test verse", "Self Test 1:1"]
    );

    const [verseRows] = await conn.query(
      "SELECT id FROM bible_verses WHERE id = ?",
      [verse.insertId]
    );

    if (verseRows.length !== 1) {
      throw new Error("Bible verse was not stored correctly.");
    }

    await conn.rollback();

    // Safety cleanup in case a table type does not support rollback
    await db.query("DELETE FROM messages WHERE userId = ?", ["__selftest__"]);
    await db.query("DELETE FROM bible_verses WHERE reference_text = ?", ["Self Test 1:1"]);

    console.log("SELF-TEST PASSED: messages, replies, and bible verses can be saved.");
    return true;
  } catch (err) {
    try {
      await conn.rollback();
    } catch (e) {
      // ignore
    }
    console.error("SELF-TEST FAILED:", err.code || "", err.sqlMessage || err.message);
    console.error("Send this error message so it can be fixed.");
    return false;
  } finally {
    conn.release();
  }
}

async function initDatabase() {
  // 1. Create the database if it does not exist
  const setupConnection = await mysql.createConnection(DB_CONFIG);

  await setupConnection.query(
    `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`
     CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`
  );
  await setupConnection.end();
  console.log(`Database ready: ${DB_NAME}`);

  // 2. Create the connection pool using that database
  db = mysql.createPool({
    ...DB_CONFIG,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    dateStrings: true
  });

  // 3. Create tables if they do not exist
  await db.query(
    `CREATE TABLE IF NOT EXISTS church_events (
      event_id INT AUTO_INCREMENT PRIMARY KEY,
      event_name VARCHAR(255) NOT NULL,
      event_date VARCHAR(100) NOT NULL,
      location VARCHAR(255) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await db.query(
    `CREATE TABLE IF NOT EXISTS announcements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      date DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await db.query(
    `CREATE TABLE IF NOT EXISTS bible_verses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      verse_text TEXT NOT NULL,
      reference_text VARCHAR(255) NOT NULL,
      verse_date DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await db.query(
    `CREATE TABLE IF NOT EXISTS messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId VARCHAR(100) NOT NULL,
      name VARCHAR(100) DEFAULT 'Member',
      message TEXT NOT NULL,
      reply TEXT NULL,
      date DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  // 4. Add missing columns to tables that already existed
  await ensureColumn("announcements", "date", "DATETIME DEFAULT CURRENT_TIMESTAMP");
  await ensureColumn("bible_verses", "verse_date", "DATETIME DEFAULT CURRENT_TIMESTAMP");

  await ensureColumn("messages", "userId", "VARCHAR(100) NOT NULL DEFAULT ''");
  await ensureColumn("messages", "name", "VARCHAR(100) DEFAULT 'Member'");
  await ensureColumn("messages", "message", "TEXT NULL");
  await ensureColumn("messages", "reply", "TEXT NULL");
  await ensureColumn("messages", "date", "DATETIME DEFAULT CURRENT_TIMESTAMP");

  // 5. Fix the messages table if it has a different or old structure
  await repairMessagesTable();

  // 6. Show the messages table columns in the terminal (for debugging)
  const [columns] = await db.query("SHOW COLUMNS FROM messages");
  console.log(
    "messages table columns:",
    columns.map((c) => `${c.Field} (${c.Type})`).join(", ")
  );

  console.log("All tables are ready.");

  // 7. Prove that saving really works on this database
  await runSelfTest();
}

// ======================================
// HOME / HEALTH CHECK
// ======================================

app.get("/", (req, res) => {
  res.json({
    message: "Shepherd of My Soul Backend is running!"
  });
});

app.get("/api/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({
      status: "OK",
      message: "Backend and database are working."
    });
  } catch (err) {
    res.status(500).json({
      status: "ERROR",
      message: "Database is not reachable: " + err.message
    });
  }
});

// ======================================
// REQUEST LOGGER
// ======================================

app.use((req, res, next) => {
  if (req.method === "POST" || req.method === "PUT" || req.method === "DELETE") {
    console.log("REQUEST:", req.method, req.originalUrl);
    console.log("BODY:", req.body);
  }
  next();
});

// ======================================
// EVENTS
// ======================================

app.get("/api/events", async (req, res) => {
  try {
    const [events] = await db.query(
      `SELECT
        event_id AS id,
        event_name AS name,
        event_date AS date,
        location
       FROM church_events
       ORDER BY event_date ASC`
    );

    res.json(events);
  } catch (err) {
    console.error("LOAD EVENTS ERROR:", err.message);
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/events", async (req, res) => {
  try {
    const { name, date, location } = req.body;

    if (!name || !date || !location) {
      return res.status(400).json({
        message: "Name, date, and location are required."
      });
    }

    const [result] = await db.query(
      `INSERT INTO church_events
       (event_name, event_date, location)
       VALUES (?, ?, ?)`,
      [name, date, location]
    );

    const event = {
      id: result.insertId,
      name,
      date,
      location
    };

    console.log("SUCCESS: New event added!", event);

    res.status(201).json({
      message: "Event added successfully.",
      event
    });
  } catch (err) {
    console.error("ADD EVENT ERROR:", err.message);
    res.status(500).json({ message: err.message });
  }
});

app.put("/api/events/:id", async (req, res) => {
  try {
    const { name, date, location } = req.body;
    const { id } = req.params;

    if (!name || !date || !location) {
      return res.status(400).json({
        message: "Name, date, and location are required."
      });
    }

    const [result] = await db.query(
      `UPDATE church_events
       SET event_name = ?, event_date = ?, location = ?
       WHERE event_id = ?`,
      [name, date, location, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Event not found."
      });
    }

    console.log("UPDATED EVENT ID:", id);

    res.json({ message: "Event updated successfully." });
  } catch (err) {
    console.error("UPDATE EVENT ERROR:", err.message);
    res.status(500).json({ message: err.message });
  }
});

app.delete("/api/events/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query(
      "DELETE FROM church_events WHERE event_id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Event not found."
      });
    }

    console.log("DELETED EVENT ID:", id);

    res.json({ message: "Event deleted successfully." });
  } catch (err) {
    console.error("DELETE EVENT ERROR:", err.message);
    res.status(500).json({ message: err.message });
  }
});

// ======================================
// ANNOUNCEMENTS
// ======================================

app.get("/api/announcements", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, title, message, date
       FROM announcements
       ORDER BY id DESC`
    );

    res.json(rows);
  } catch (err) {
    console.error("LOAD ANNOUNCEMENTS ERROR:", err.message);
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/announcements", async (req, res) => {
  try {
    const { title, message } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        message: "Title and message are required."
      });
    }

    const [result] = await db.query(
      `INSERT INTO announcements (title, message)
       VALUES (?, ?)`,
      [title, message]
    );

    const announcement = {
      id: result.insertId,
      title,
      message
    };

    console.log("NEW ANNOUNCEMENT:", announcement);

    res.status(201).json({
      message: "Announcement added successfully.",
      announcement
    });
  } catch (err) {
    console.error("ADD ANNOUNCEMENT ERROR:", err.message);
    res.status(500).json({ message: err.message });
  }
});

app.put("/api/announcements/:id", async (req, res) => {
  try {
    const { title, message } = req.body;
    const { id } = req.params;

    if (!title || !message) {
      return res.status(400).json({
        message: "Title and message are required."
      });
    }

    const [result] = await db.query(
      `UPDATE announcements
       SET title = ?, message = ?
       WHERE id = ?`,
      [title, message, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Announcement not found."
      });
    }

    console.log("UPDATED ANNOUNCEMENT ID:", id);

    res.json({
      message: "Announcement updated successfully."
    });
  } catch (err) {
    console.error("UPDATE ANNOUNCEMENT ERROR:", err.message);
    res.status(500).json({ message: err.message });
  }
});

app.delete("/api/announcements/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query(
      "DELETE FROM announcements WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Announcement not found."
      });
    }

    console.log("DELETED ANNOUNCEMENT ID:", id);

    res.json({
      message: "Announcement deleted successfully."
    });
  } catch (err) {
    console.error("DELETE ANNOUNCEMENT ERROR:", err.message);
    res.status(500).json({ message: err.message });
  }
});

// ======================================
// BIBLE VERSES
// ======================================

app.get("/api/bible-verses", async (req, res) => {
  try {
    const [verses] = await db.query(
      `SELECT
        id,
        verse_text AS text,
        reference_text AS reference,
        verse_date AS date
       FROM bible_verses
       ORDER BY id DESC`
    );

    res.json(verses);
  } catch (err) {
    console.error("LOAD BIBLE VERSES ERROR:", err.message);
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/bible-verses", async (req, res) => {
  try {
    const { text, reference } = req.body;

    if (!text || !reference) {
      return res.status(400).json({
        message: "Verse and reference are required."
      });
    }

    const [result] = await db.query(
      `INSERT INTO bible_verses
       (verse_text, reference_text)
       VALUES (?, ?)`,
      [text, reference]
    );

    const bibleVerse = {
      id: result.insertId,
      text,
      reference
    };

    console.log("NEW BIBLE VERSE:", bibleVerse);

    res.status(201).json({
      message: "Bible verse added successfully.",
      bibleVerse
    });
  } catch (err) {
    console.error("ADD BIBLE VERSE ERROR:", err.message);
    res.status(500).json({ message: err.message });
  }
});

app.put("/api/bible-verses/:id", async (req, res) => {
  try {
    const { text, reference } = req.body;
    const { id } = req.params;

    if (!text || !reference) {
      return res.status(400).json({
        message: "Verse and reference are required."
      });
    }

    const [result] = await db.query(
      `UPDATE bible_verses
       SET verse_text = ?, reference_text = ?
       WHERE id = ?`,
      [text, reference, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Bible verse not found."
      });
    }

    console.log("UPDATED BIBLE VERSE ID:", id);

    res.json({
      message: "Bible verse updated successfully."
    });
  } catch (err) {
    console.error("UPDATE BIBLE VERSE ERROR:", err.message);
    res.status(500).json({ message: err.message });
  }
});

app.delete("/api/bible-verses/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query(
      "DELETE FROM bible_verses WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Bible verse not found."
      });
    }

    console.log("DELETED BIBLE VERSE ID:", id);

    res.json({
      message: "Bible verse deleted successfully."
    });
  } catch (err) {
    console.error("DELETE BIBLE VERSE ERROR:", err.message);
    res.status(500).json({ message: err.message });
  }
});

// ======================================
// USER AND ADMIN MESSAGES
// ======================================

// GET ALL MESSAGES
app.get("/api/messages", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, userId, name, message, reply, date
       FROM messages
       ORDER BY id DESC`
    );

    res.json(rows);
  } catch (err) {
    console.error("LOAD MESSAGES ERROR:", err.message);
    res.status(500).json({ message: err.message });
  }
});

// SEND MESSAGE FROM USER
app.post("/api/messages", async (req, res) => {
  try {
    const body = req.body || {};

    // Accept a few common field names so the frontend can't fail on naming
    const userId = body.userId ?? body.user_id ?? body.userID;
    const rawMessage = body.message ?? body.text ?? body.content;
    const rawName = body.name ?? body.userName ?? body.username;

    const hasUserId =
      userId !== undefined && userId !== null && String(userId).trim() !== "";

    if (!hasUserId || typeof rawMessage !== "string" || !rawMessage.trim()) {
      console.log("MESSAGE REJECTED. Received body:", body);
      return res.status(400).json({
        message: "User and message are required."
      });
    }

    const cleanUserId = String(userId).trim();
    const cleanMessage = rawMessage.trim();
    const cleanName =
      typeof rawName === "string" && rawName.trim() ? rawName.trim() : "Member";

    const [result] = await db.query(
      `INSERT INTO messages (userId, name, message, date)
       VALUES (?, ?, ?, NOW())`,
      [cleanUserId, cleanName, cleanMessage]
    );

    const [rows] = await db.query(
      `SELECT id, userId, name, message, reply, date
       FROM messages
       WHERE id = ?`,
      [result.insertId]
    );

    console.log("SUCCESS: NEW USER MESSAGE SAVED:", rows[0]);

    res.status(201).json({
      message: "Message sent successfully.",
      item: rows[0]
    });
  } catch (err) {
    console.error(
      "SEND MESSAGE ERROR:",
      err.code || "",
      err.sqlMessage || err.message
    );
    res.status(500).json({
      message: err.sqlMessage || err.message
    });
  }
});

// ADMIN REPLY
app.put("/api/messages/:id", async (req, res) => {
  try {
    const { reply } = req.body;
    const { id } = req.params;

    if (typeof reply !== "string" || !reply.trim()) {
      return res.status(400).json({
        message: "Please enter a reply."
      });
    }

    const [result] = await db.query(
      "UPDATE messages SET reply = ? WHERE id = ?",
      [reply.trim(), id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Message not found."
      });
    }

    console.log("ADMIN REPLIED TO MESSAGE ID:", id);

    res.json({
      message: "Reply saved successfully."
    });
  } catch (err) {
    console.error("SAVE REPLY ERROR:", err.message);
    res.status(500).json({ message: err.message });
  }
});

app.delete("/api/messages/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query(
      "DELETE FROM messages WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Message not found."
      });
    }

    console.log("DELETED MESSAGE ID:", id);

    res.json({
      message: "Message deleted successfully."
    });
  } catch (err) {
    console.error("DELETE MESSAGE ERROR:", err.message);
    res.status(500).json({ message: err.message });
  }
});

// ======================================
// START SERVER
// ======================================

async function startServer() {
  try {
    await initDatabase();

    app.listen(PORT, () => {
      console.log(`Backend Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("STARTUP FAILED:", err.message);
    console.error(
      "Check that MySQL (XAMPP) is running and your DB_HOST, DB_USER, DB_PASSWORD, DB_PORT settings are correct."
    );
    process.exit(1);
  }
}

startServer();