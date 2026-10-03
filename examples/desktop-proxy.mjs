import { request } from "node:http";

/** Mount on the host's existing authenticated HTTP server.
 * authorize must verify the user's account/workspace and return a scoped Opcode
 * credential for THIS workspace. It must not trust an unsigned identity header.
 * Keep tokens server-side. Revoke grants at the broker when host access expires.
 */
export function opcodeProxy({ authorize, basePath = "/desktop" }) {
  return async (req, res) => {
    try {
      const binding = await authorize(req);
      if (!binding) {
        res.writeHead(403);
        res.end();
        return;
      }
      const upstream = new URL(binding.endpoint);
      if (
        upstream.protocol !== "http:" ||
        !["127.0.0.1", "localhost", "[::1]"].includes(upstream.hostname)
      )
        throw Error("Expected trusted loopback tunnel.");
      const incoming = new URL(req.url, "http://host.invalid");
      if (
        incoming.pathname !== basePath + "/view" &&
        incoming.pathname !== basePath + "/rpc" &&
        incoming.pathname !== basePath + "/frame" &&
        incoming.pathname !== basePath + "/session" &&
        !incoming.pathname.startsWith(basePath + "/artifacts/")
      ) {
        res.writeHead(404);
        res.end();
        return;
      }
      // Configure Opcode's basePath to match this mount and origin to the host origin.
      upstream.pathname = incoming.pathname;
      upstream.search = incoming.search;
      const headers = { authorization: "Bearer " + binding.token };
      for (const name of ["content-type", "range", "origin"])
        if (req.headers[name]) headers[name] = req.headers[name];
      const proxy = request(
        upstream,
        { method: req.method, headers },
        (response) => {
          res.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(res);
        },
      );
      proxy.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      res.on("close", () => proxy.destroy());
      req.pipe(proxy);
    } catch {
      res.writeHead(403);
      res.end();
    }
  };
}
