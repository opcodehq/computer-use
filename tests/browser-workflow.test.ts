import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserTools } from "../src/browser/tools.js";
import { browserFixture } from "../src/benchmark/browser-fixture.js";
import { workflowService } from "../src/workflow/service.js";
const chrome = process.env.TEST_CHROME_PATH ?? "/usr/bin/google-chrome";
(existsSync(chrome) ? test : test.skip)(
  "real browser workflow fills, saves, reopens and independently verifies its persisted result",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "cu-browser-workflow-")),
      fixture = await browserFixture("create", dir, 1);
    const browser = new BrowserTools({
      executablePath: chrome,
      headless: true,
      args: ["--no-sandbox"],
    });
    try {
      const opened = (await browser.call({ operation: "open" })) as any,
        pageId = opened.tabs[0].id;
      await browser.call({ operation: "navigate", pageId, url: fixture.url });
      const service = workflowService(
        async () => {
          throw Error("Native route forbidden");
        },
        (_m, a, s) => browser.call(a, s),
        () => {},
        join(dir, "workflows"),
      );
      const workflow = {
        version: 1,
        id: "browser-create",
        description: "Create project",
        scope: { route: "browser", origin: fixture.url },
        effect: "write",
        inputs: { project: {}, owner: {} },
        outputs: [],
        steps: [
          {
            kind: "action",
            target: { name: "Project name" },
            operation: "setValue",
            value: { input: "project" },
          },
          { kind: "action", target: { name: "Next" }, operation: "press" },
          {
            kind: "action",
            target: { name: "Owner" },
            operation: "setValue",
            value: { input: "owner" },
          },
          { kind: "action", target: { name: "Review" }, operation: "press" },
          {
            kind: "action",
            target: { name: "Save project" },
            operation: "press",
            commit: true,
          },
          {
            kind: "wait",
            condition: {
              target: { name: "Result" },
              value: { literal: "Saved; reopen to verify" },
            },
          },
          {
            kind: "action",
            target: { name: "Reopen saved project" },
            operation: "press",
          },
          {
            kind: "wait",
            condition: {
              target: { name: "Result" },
              value: {
                parts: [{ literal: "Verified " }, { input: "project" }],
              },
            },
          },
          {
            kind: "assert",
            condition: {
              target: { name: "Result" },
              value: {
                parts: [{ literal: "Verified " }, { input: "project" }],
              },
            },
          },
        ],
      };
      const record = (await service({
        operation: "register",
        workflow,
      })) as any;
      const receipt = (await service({
        operation: "validate",
        id: workflow.id,
        revision: record.revision,
        effect: "write",
        pageId,
        input: { project: fixture.values.name, owner: fixture.values.owner },
      })) as any;
      assert.equal(receipt.status, "passed", JSON.stringify(receipt));
      assert.equal(
        JSON.parse(await readFile(join(dir, "result.json"), "utf8")).verified,
        true,
      );
      const focused = (await browser.call({
        operation: "observe",
        pageId,
        query: "Result",
        includeText: false,
        nodeLimit: 1,
      })) as any;
      assert.equal(focused.nodes.length, 1);
      assert.equal(focused.text, undefined);
      let fields = (await browser.call({
        operation: "observe",
        pageId,
      })) as any;
      await browser.call({
        operation: "fill",
        pageId,
        snapshotId: fields.snapshotId,
        ref: fields.nodes.find((n: any) => n.name === "Project name").ref,
        text: "Prefix",
      });
      fields = (await browser.call({ operation: "observe", pageId })) as any;
      await browser.call({
        operation: "insertText",
        pageId,
        snapshotId: fields.snapshotId,
        ref: fields.nodes.find((n: any) => n.name === "Project name").ref,
        text: "Suffix",
      });
      fields = (await browser.call({ operation: "observe", pageId })) as any;
      assert.equal(
        fields.nodes.find((n: any) => n.name === "Project name").value,
        "PrefixSuffix",
      );
      await browser.call({
        operation: "fill",
        pageId,
        snapshotId: fields.snapshotId,
        ref: fields.nodes.find((n: any) => n.name === "Project name").ref,
        text: "",
      });
      fields = (await browser.call({ operation: "observe", pageId })) as any;
      assert.equal(
        fields.nodes.find((n: any) => n.name === "Project name").value,
        "",
      );
    } finally {
      await browser.close();
      await fixture.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
