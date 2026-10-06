function list(raw: string | undefined) {
	return (raw ?? "").split(",").map(s => s.trim()).filter(Boolean);
}

function required(name: string) {
	const value = Bun.env[name];
	if (!value) throw new Error(`${name} is not set (see .env.example)`);
	return value;
}

export const env = {
	port: parseInt(Bun.env.PORT || "7780", 10),
	dbConnection: required("DB_CONNECTION"),
	/** Public origin of the dashboard, used to build /resize URLs handed to Telegram */
	publicUrl: (Bun.env.PUBLIC_URL || "").replace(/\/$/, ""),
	corsOrigins: list(Bun.env.CORS_ORIGIN),
	resizeHosts: list(Bun.env.RESIZE_HOSTS || "gelbooru.com").map(h => h.toLowerCase()),
	outboundProxy: Bun.env.OUTBOUND_PROXY || null,
	tgToken: Bun.env.TG_TOKEN || "",
	tgTargetMe: Bun.env.TG_TARGET_ME || ""
};

if (!env.publicUrl)
	console.warn("PUBLIC_URL is not set: Telegram will not be able to reach the /resize image proxy");
