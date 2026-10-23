const express = require("express");
const cors = require("cors");
const app = express();
const PORT = process.env.PORT || 8080;
app.use(cors());
app.use(express.json());

let events = [
  {
    id: 1,
    name: "Sunday Worship",
    date: "2026-09-20",
    location: "Church Hall",
  },
  {
    id: 2,
    name: "Bible Study",
    date: "2026-09-22",
    location: "Room 2",
  },
  {
    id: 3,
    name: "Prayer Meeting",
    date: "2026-09-24",
    location: "Church Hall",
  },
];

let announcements = [];
let bibleVerses = [];
let messages = [];

const nextId = () => Date.now() + Math.floor(Math.random() * 1000);
app.use((req, res, next) => {
  if (req.method === "POST") {
    console.log("\n========== INCOMING POST REQUEST ==========");
    console.log("URL:", req.originalUrl);
    console.log("Body:", req.body);
    console.log("===========================================\n");
  }
  next();
});

// EVENTS
app.get("/api/events", (req, res) => {
  res.json(events);
});

app.post("/api/events", (req, res) => {
  const { name, date, location } = req.body;

  if (!name || !date || !location) {
    console.log("ERROR: Event fields are missing.");
    return res.status(400).json({
      message: "Name, date, and location are required.",
    });
  }

  const event = { id: nextId(), name, date, location };
  events.push(event);

  console.log("SUCCESS: New event added!");
  console.log(event);
  console.log("Total events:", events.length);

  res.status(201).json({
    message: "Event added successfully",
    event,
  });
});

app.put("/api/events/:id", (req, res) => {
  const index = events.findIndex(
    (x) => x.id === Number(req.params.id)
  );

  if (index < 0) {
    return res.status(404).json({ message: "Event not found." });
  }

  events[index] = {
    ...events[index],
    ...req.body,
    id: events[index].id,
  };

  console.log("UPDATED EVENT:", events[index]);
  res.json({ event: events[index] });
});

app.delete("/api/events/:id", (req, res) => {
  const before = events.length;

  events = events.filter(
    (x) => x.id !== Number(req.params.id)
  );

  if (before === events.length) {
    return res.status(404).json({ message: "Event not found." });
  }

  console.log("DELETED EVENT ID:", req.params.id);
  res.json({ message: "Event deleted." });
});

app.get("/api/announcements", (req, res) => {
  res.json(announcements);
});

app.post("/api/announcements", (req, res) => {
  const { title, message } = req.body;

  if (!title || !message) {
    console.log("ERROR: Announcement fields are missing.");
    return res.status(400).json({
      message: "Title and message are required.",
    });
  }

  const item = {
    id: nextId(),
    title,
    message,
    date: new Date().toLocaleDateString(),
  };

  announcements.push(item);

  console.log("SUCCESS: New announcement added!");
  console.log(item);
  console.log("Total announcements:", announcements.length);

  res.status(201).json({
    message: "Announcement added successfully",
    announcement: item,
  });
});

app.put("/api/announcements/:id", (req, res) => {
  const index = announcements.findIndex(
    (x) => x.id === Number(req.params.id)
  );

  if (index < 0) {
    return res.status(404).json({
      message: "Announcement not found.",
    });
  }

  announcements[index] = {
    ...announcements[index],
    ...req.body,
    id: announcements[index].id,
  };

  console.log("UPDATED ANNOUNCEMENT:", announcements[index]);
  res.json({ announcement: announcements[index] });
});

app.delete("/api/announcements/:id", (req, res) => {
  const before = announcements.length;

  announcements = announcements.filter(
    (x) => x.id !== Number(req.params.id)
  );

  if (before === announcements.length) {
    return res.status(404).json({
      message: "Announcement not found.",
    });
  }

  console.log("DELETED ANNOUNCEMENT ID:", req.params.id);
  res.json({ message: "Announcement deleted." });
});

app.get("/api/bible-verses", (req, res) => {
  res.json(bibleVerses);
});

app.post("/api/bible-verses", (req, res) => {
  const { text, reference } = req.body;

  if (!text || !reference) {
    console.log("ERROR: Bible verse fields are missing.");
    return res.status(400).json({
      message: "Verse and reference are required.",
    });
  }

  const item = {
    id: nextId(),
    text,
    reference,
    date: new Date().toLocaleDateString(),
  };

  bibleVerses.push(item);

  console.log("SUCCESS: New Bible verse added!");
  console.log(item);
  console.log("Total Bible verses:", bibleVerses.length);

  res.status(201).json({
    message: "Bible verse added successfully",
    bibleVerse: item,
  });
});

app.put("/api/bible-verses/:id", (req, res) => {
  const index = bibleVerses.findIndex(
    (x) => x.id === Number(req.params.id)
  );

  if (index < 0) {
    return res.status(404).json({
      message: "Bible verse not found.",
    });
  }

  bibleVerses[index] = {
    ...bibleVerses[index],
    ...req.body,
    id: bibleVerses[index].id,
  };

  console.log("UPDATED BIBLE VERSE:", bibleVerses[index]);
  res.json({ bibleVerse: bibleVerses[index] });
});

app.delete("/api/bible-verses/:id", (req, res) => {
  const before = bibleVerses.length;

  bibleVerses = bibleVerses.filter(
    (x) => x.id !== Number(req.params.id)
  );

  if (before === bibleVerses.length) {
    return res.status(404).json({
      message: "Bible verse not found.",
    });
  }

  console.log("DELETED BIBLE VERSE ID:", req.params.id);
  res.json({ message: "Bible verse deleted." });
});

app.get("/api/messages", (req, res) => {
  res.json(messages);
});

app.post("/api/messages", (req, res) => {
  const { userId, name, message } = req.body;

  if (!userId || !message) {
    console.log("ERROR: Message fields are missing.");
    return res.status(400).json({
      message: "User and message are required.",
    });
  }

  const item = {
    id: nextId(),
    userId,
    name: name || "Member",
    message,
    reply: "",
    date: new Date().toLocaleString(),
  };

  messages.push(item);

  console.log("SUCCESS: New message received!");
  console.log(item);
  console.log("Total messages:", messages.length);

  res.status(201).json({
    message: "Message sent.",
    item,
  });
});

app.put("/api/messages/:id", (req, res) => {
  const index = messages.findIndex(
    (x) => x.id === Number(req.params.id)
  );

  if (index < 0) {
    return res.status(404).json({
      message: "Message not found.",
    });
  }

  messages[index] = {
    ...messages[index],
    reply: req.body.reply || "",
  };

  console.log("UPDATED MESSAGE:", messages[index]);
  res.json({ item: messages[index] });
});

app.delete("/api/messages/:id", (req, res) => {
  const before = messages.length;

  messages = messages.filter(
    (x) => x.id !== Number(req.params.id)
  );

  if (before === messages.length) {
    return res.status(404).json({
      message: "Message not found.",
    });
  }

  console.log("DELETED MESSAGE ID:", req.params.id);
  res.json({ message: "Message deleted." });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", port: PORT });
});

app.listen(PORT, () => {
  console.log(`Backend Server running on port ${PORT}`);
});