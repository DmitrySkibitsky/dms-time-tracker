// HTTP front for the in-memory Clockify fake, used by the QML integration test to exercise
// the real XMLHttpRequest transport end to end.
//
//   node tests/integration/mockServer.ts <out-file>
//
// Listens on a random local port and writes `export const BASE_URL = "..."` to <out-file>
// once ready. Stops on SIGTERM/SIGINT.

import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { HttpRequest } from "../../src/core/types.ts";
import { createClockifyFake } from "../fakes/clockifyFake.ts";

const outFile = process.argv[2];
if (!outFile) {
    console.error("usage: mockServer.ts <out-file>");
    process.exit(2);
}

const fake = createClockifyFake();
fake.seed({ description: "Seeded over HTTP", projectId: "p-web", start: Date.now() - 2 * 3_600_000, end: Date.now() - 3_600_000 });

const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(chunk as Buffer));
    req.on("end", () => {
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(req.headers)) {
            if (typeof value === "string") headers[name.toLowerCase() === "x-api-key" ? "X-Api-Key" : name] = value;
        }
        const body = Buffer.concat(chunks).toString("utf8");
        const response = fake.handle({
            method: (req.method ?? "GET") as HttpRequest["method"],
            url: req.url ?? "/",
            headers,
            body: body === "" ? null : body
        });
        res.writeHead(response.status, { "Content-Type": "application/json" });
        res.end(response.body);
    });
});

server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("unexpected server address");
    writeFileSync(outFile, `export const BASE_URL = "http://127.0.0.1:${address.port}/api/v1";\n`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => server.close(() => process.exit(0)));
