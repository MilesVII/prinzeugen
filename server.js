import express from "express";
import path from "node:path";
import { fileURLToPath } from 'url';
import handler from "./core/main.js";
import imageproxy from "./core/imgproxy.js";

const app = express();
const port = 7780; // Change this to your desired port number

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename); 

app.use(express.static(path.join(__dirname, "frontend", "dist")));
app.use(express.json());

app.get('/', (req, res) => {
	res.sendFile(path.join(__dirname, "frontend", "dist", "index.html"));
});

app.get("/imageproxy", async (req, res) => {
	await imageproxy(req, res);
});
app.post("/imageproxy", async (req, res) => {
	await imageproxy(req, res);
});

app.route("/api")
	.all(async (req, res) => {
		res.set("Access-Control-Allow-Origin", "http://localhost:3000");
		res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
		res.set("Access-Control-Allow-Headers", "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version");
		res.set("Access-Control-Allow-Credentials", true);

		if (req.method === "OPTIONS") {
			res.status(200).end();
			return;
		}

		await handler(req, res);
	});

// Start the server
app.listen(port, () => {
	console.log(`Server online, port ${port}`);
});
