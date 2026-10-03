import { randomUUID } from "node:crypto";
import type { Authority, Grant } from "./authority.js";
import { failure, type Participant } from "./protocol.js";

/** Visual cursors are presence only. Actual OS input remains lease-controlled. */
export class Presence {
  private entries = new Map<
    string,
    { grantId: string; value: Participant; updatedAt: number }
  >();
  constructor(
    private authority: Authority,
    private now = () => Date.now(),
  ) {}
  sweep() {
    const removed: string[] = [];
    for (const [id, entry] of this.entries) {
      if (
        entry.value.expiresAt <= this.now() ||
        !this.authority.valid(entry.grantId)
      ) {
        this.entries.delete(id);
        removed.push(id);
      }
    }
    return removed;
  }
  list(): Participant[] {
    this.sweep();
    return [...this.entries.values()].map(({ value }) =>
      structuredClone(value),
    );
  }
  has(id: string) {
    this.sweep();
    return this.entries.has(id);
  }
  require(grant: Grant, id: string) {
    this.sweep();
    const entry = this.entries.get(id);
    if (!entry || entry.grantId !== grant.id)
      throw failure(
        "participant_expired",
        "Participant expired or belongs to another credential; join again.",
      );
    return entry;
  }
  join(
    grant: Grant,
    name: string | undefined,
    role: Participant["role"],
  ): Participant {
    this.sweep();
    if (
      this.entries.size >= 64 ||
      [...this.entries.values()].filter((e) => e.grantId === grant.id).length >=
        8
    )
      throw failure("overloaded", "Participant limit reached.");
    const id = randomUUID();
    const colors = [
      "#60a5fa",
      "#f472b6",
      "#34d399",
      "#fbbf24",
      "#a78bfa",
      "#fb923c",
    ];
    const value: Participant = {
      id,
      subject: grant.subject,
      name: name ?? grant.subject.slice(0, 64),
      role,
      color: colors[parseInt(id.slice(0, 8), 16) % colors.length] ?? "#60a5fa",
      cursor: null,
      expiresAt: Math.min(grant.expiresAt, this.now() + 15000),
    };
    this.entries.set(id, { grantId: grant.id, value, updatedAt: -Infinity });
    return structuredClone(value);
  }
  update(
    grant: Grant,
    id: string,
    cursor: Participant["cursor"] | undefined,
  ): Participant {
    const entry = this.require(grant, id);
    if (this.now() - entry.updatedAt < 40)
      throw failure(
        "overloaded",
        "Presence updates are limited to 25 per second.",
      );
    entry.updatedAt = this.now();
    if (cursor !== undefined) entry.value.cursor = cursor;
    entry.value.expiresAt = Math.min(grant.expiresAt, this.now() + 15000);
    return structuredClone(entry.value);
  }
  leave(grant: Grant, id: string) {
    this.require(grant, id);
    this.entries.delete(id);
  }
  clear() {
    this.entries.clear();
  }
}
