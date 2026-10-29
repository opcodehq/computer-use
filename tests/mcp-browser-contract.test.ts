import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const chrome = process.env.TEST_CHROME_PATH ?? '/usr/bin/google-chrome';
(existsSync(chrome) ? test : test.skip)('MCP exposes batch fields and returns usable fresh form state', { timeout: 30000 }, async () => {
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<title>MCP form</title><label>Customer<input name="customer"></label><label>Owner<select><option value="a">Alex</option><option value="m">Maya</option></select></label>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const transport = new StdioClientTransport({ command: process.execPath, args: ['src/tool/cli.ts', 'mcp', '--no-preview'], cwd: process.cwd(), stderr: 'pipe' });
  const client = new Client({ name: 'contract-test', version: '1' });
  try {
    await client.connect(transport);
    const catalog = await client.listTools();
    const browser = catalog.tools.find(tool => tool.name === 'desktop_browser')!;
    const properties = browser.inputSchema.properties as Record<string, any>;
    const validate = new AjvJsonSchemaValidator().getValidator(browser.inputSchema);
    for (const operation of ['click','doubleClick','rightClick','hover','drag','fill','insertText','key','scroll','select','upload']) {
      assert.equal(validate({operation,pageId:'page',ref:'ref'}).valid,false,operation+' requires snapshotId');
      assert.equal(validate({operation,pageId:'page',snapshotId:'snapshot'}).valid,false,operation+' requires ref');
      assert.equal(validate({operation,snapshotId:'snapshot',ref:'ref'}).valid,false,operation+' requires pageId');
      assert.equal(validate({operation,pageId:'page',snapshotId:'snapshot',ref:'ref'}).valid,true);
    }
    assert.equal(validate({operation:'fillForm',pageId:'page',fields:[{ref:'ref',text:'value'}]}).valid,false);
    assert.equal(validate({operation:'fillForm',pageId:'page',snapshotId:'snapshot',fields:[{ref:'ref',text:'value'}]}).valid,true);
    assert.equal(validate({operation:'open'}).valid,true);
    assert.equal(validate({operation:'attach',endpoint:'http://localhost:9222'}).valid,true);

    assert.ok(properties.operation.enum.includes('fillForm'));
    assert.equal(properties.fields.maxItems, 40);
    const keyboard = catalog.tools.find(tool => tool.name === 'desktop_key')!;
    assert.equal((keyboard.inputSchema.properties as Record<string, any>).key.enum, undefined);
    const call = async (args: Record<string, unknown>): Promise<any> => {
      const result = await client.callTool({ name: 'desktop_browser', arguments: args });
      assert.notEqual(result.isError, true);
      const content = result.content as Array<{ type: string; text?: string }>;
      const value = JSON.parse(content.find(item => item.type === 'text')!.text!);
      assert.notEqual(value.status, 'error', JSON.stringify(value));
      return value;
    };
    const opened = await call({ operation: 'open' });
    const pageId = opened.tabs[0].id;
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const state = await call({ operation: 'navigate', pageId, url: `http://127.0.0.1:${address.port}` });
    const customer = state.nodes.find((node: any) => node.name === 'Customer');
    const owner = state.nodes.find((node: any) => node.name === 'Owner');
    assert.ok(customer && owner);
    const filled = await call({ operation: 'fillForm', pageId, snapshotId: state.snapshotId, fields: [{ ref: customer.ref, text: 'Harbor' }, { ref: owner.ref, value: 'm' }] });
    assert.equal(filled.completedFields, 2);
    assert.notEqual(filled.snapshotId, state.snapshotId);
    assert.equal(filled.nodes.find((node: any) => node.name === 'Customer').value, 'Harbor');
    assert.equal(filled.nodes.find((node: any) => node.name === 'Owner').value, 'm');
  } finally {
    await client.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
