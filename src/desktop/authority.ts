import { randomBytes, randomUUID } from "node:crypto";
import { failure, type Scope } from "./protocol.js";
export type Grant = {
  id: string;
  subject: string;
  scopes: Scope[];
  expiresAt: number;
  generation: string;
};
export class Authority {
  private grants = new Map<string, Grant>();
  constructor(
    public generation: string,
    private now = () => Date.now(),
  ) {}
  issue(subject: string, scopes: Scope[], ttlMs: number) {
    if (this.grants.size >= 1024) {
      for (const [token, g] of this.grants)
        if (g.expiresAt <= this.now()) this.grants.delete(token);
      if (this.grants.size >= 1024)
        throw failure("overloaded", "Grant limit reached.");
    }
    const token = randomBytes(32).toString("hex");
    const grant: Grant = {
      id: randomUUID(),
      subject,
      scopes,
      expiresAt: this.now() + Math.min(Math.max(ttlMs, 1000), 3600000),
      generation: this.generation,
    };
    this.grants.set(token, grant);
    return { token, ...grant };
  }
  verify(token: string, scope?: Scope) {
    const grant = this.grants.get(token);
    if (
      !grant ||
      grant.expiresAt <= this.now() ||
      grant.generation !== this.generation
    )
      throw failure(
        "permission_denied",
        "Credential expired, revoked or invalid.",
      );
    if (scope && !grant.scopes.includes(scope))
      throw failure("permission_denied", "Credential lacks required scope.");
    return grant;
  }
  revoke(id: string) {
    for (const [token, g] of this.grants)
      if (g.id === id) this.grants.delete(token);
  }
  rebind(generation: string) {
    this.generation = generation;
    this.grants.clear();
  }
  valid(id: string) {
    return [...this.grants.values()].some(
      (g) =>
        g.id === id &&
        g.generation === this.generation &&
        g.expiresAt > this.now(),
    );
  }
}
