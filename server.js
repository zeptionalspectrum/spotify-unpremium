const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const { v4: uuidv4 } = require("uuid");
const socketio = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketio(server);

// --- Configuration ---
const PORT = 3000;
const DB_PATH = path.join(__dirname, "db.json");

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(session({
    secret: "party-secret-key-123",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

// --- Database Helper ---
function getDB() {
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify({ users: {}, lobbies: {} }, null, 2));
    }
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}
function saveDB(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// --- Auth Middleware ---
function isAuthenticated(req, res, next) {
    if (req.session.user) return next();
    res.redirect("/");
}

// --- Routes ---

// API: Get User Info
app.get("/api/me", (req, res) => {
    if (!req.session.user) return res.status(401).json({ user: null });
    res.json({ user: req.session.user });
});

// API: List Public Lobbies (This powers the Dashboard list)
app.get("/api/lobbies", isAuthenticated, (req, res) => {
    const db = getDB();
    const publicLobbies = Object.values(db.lobbies)
        .filter(l => !l.private) // Filter out private lobbies
        .map(l => ({
            id: l.id,
            name: l.name,
            host: l.host,
            count: l.users.length
        }));
    res.json(publicLobbies);
});

// Auth Routes
app.post("/api/register", async (req, res) => {
    const { username, password } = req.body;
    const db = getDB();
    if (db.users[username]) return res.redirect("/?error=exists");
    
    const hashedPassword = await bcrypt.hash(password, 10);
    db.users[username] = { password: hashedPassword };
    saveDB(db);
    
    req.session.user = username;
    res.redirect("/dashboard.html");
});

app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;
    const db = getDB();
    const user = db.users[username];
    
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.redirect("/?error=invalid");
    }
    
    req.session.user = username;
    res.redirect("/dashboard.html");
});

app.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/");
});

// Lobby Creation
app.post("/api/create-lobby", isAuthenticated, (req, res) => {
    const db = getDB();
    const id = uuidv4();
    
    db.lobbies[id] = {
        id,
        name: req.body.name || `${req.session.user}'s Party`,
        host: req.session.user,
        private: req.body.private === "on",
        users: [],
        ready: {},
        chat: [],
        music: { queue: [], current: null }
    };
    saveDB(db);
    res.redirect(`/lobby.html?id=${id}`);
});

// --- Socket.IO Logic ---
io.on("connection", (socket) => {
    
    socket.on("joinLobby", ({ lobbyId, username }) => {
        const db = getDB();
        const lobby = db.lobbies[lobbyId];
        
        if (!lobby) {
            socket.emit("error", "Lobby not found");
            return;
        }

        socket.join(lobbyId);
        
        // Add user if not present
        if (!lobby.users.includes(username)) {
            lobby.users.push(username);
            lobby.ready[username] = false;
        }
        
        saveDB(db);
        io.to(lobbyId).emit("stateUpdate", lobby);
    });

    socket.on("action", ({ lobbyId, username, type, payload }) => {
        const db = getDB();
        const lobby = db.lobbies[lobbyId];
        if (!lobby) return;

        switch (type) {
            case "chat":
                lobby.chat.push({ user: username, text: payload, time: Date.now() });
                if (lobby.chat.length > 50) lobby.chat.shift();
                break;
                
            case "toggleReady":
                lobby.ready[username] = !lobby.ready[username];
                break;

            case "addSong":
                // Extract Video ID from various YouTube URL formats
                let vidId = null;
                try {
                    const url = new URL(payload);
                    if (url.hostname.includes("youtube.com")) vidId = url.searchParams.get("v");
                    else if (url.hostname.includes("youtu.be")) vidId = url.pathname.slice(1);
                } catch (e) {}
                
                if (vidId) {
                    lobby.music.queue.push({ id: vidId, title: `Video ${vidId}`, addedBy: username });
                }
                break;

            case "nextSong":
                if (lobby.host === username) {
                    lobby.music.current = lobby.music.queue.shift() || null;
                }
                break;

            case "kick":
                if (lobby.host === username) {
                    lobby.users = lobby.users.filter(u => u !== payload);
                    delete lobby.ready[payload];
                }
                break;
        }

        saveDB(db);
        io.to(lobbyId).emit("stateUpdate", lobby);
    });
});

// The '0.0.0.0' is the key—it opens the door to the outside world
server.listen(3000, '0.0.0.0', () => {
  console.log('🚀 Server is LIVE and listening on all interfaces at port 3000');
});