import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
/** Resettable browser tasks. The server, not the agent, writes the grading artifact. */
export async function browserFixture(
  task: string,
  directory: string,
  seed: number,
  port = 0,
) {
  await mkdir(directory, { recursive: true });
  const name = "Project-" + seed,
    owner = "Owner-" + seed,
    category = seed % 2 ? "Research" : "Engineering";
  let saves = 0,
    invalid = 0,
    saved = false;
  const rows = [
    ...Array.from({ length: 6 }, (_, i) => ({
      name: "Other-" + i,
      owner: "Other owner",
      category: i % 2 ? "Research" : "Engineering",
    })),
    { name, owner, category },
  ];
  const expected = JSON.stringify({
    task,
    name,
    owner,
    category,
    verified: true,
  });
  const grade = () =>
    writeFile(join(directory, "result.json"), expected, { mode: 0o600 });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://fixture");
    if (url.pathname === "/action" && req.method === "POST") {
      let text = "";
      for await (const chunk of req) {
        text += chunk;
        if (text.length > 8000) {
          res.writeHead(413);
          res.end();
          return;
        }
      }
      const input = new URLSearchParams(text),
        action = input.get("action"),
        value = input.get("value");
      if (action === "save") {
        if (!value?.startsWith("Project-")) {
          invalid++;
          res.writeHead(422);
          res.end("Name must begin Project-");
          return;
        }
        if (
          value !== name ||
          (task === "create" && input.get("owner") !== owner)
        ) {
          res.writeHead(422);
          res.end("Wrong project");
          return;
        }
        saves++;
        saved = true;
        if (task === "uncertain") {
          res.destroy();
          return;
        }
      }
      if (action === "owner" || action === "confirm") saves++;
      let correct = false;
      if (task === "search") correct = action === "search" && value === name;
      if (task === "filter")
        correct = action === "filter" && value === category;
      if (task === "pagination") correct = action === "page" && value === "2";
      if (task === "details") correct = action === "details" && value === name;
      if (task === "create")
        correct = action === "reopen" && saved && saves === 1;
      if (task === "edit")
        correct = action === "owner" && value === owner && saves === 1;
      if (task === "validation")
        correct = action === "save" && saved && invalid > 0 && saves === 1;
      if (task === "dialog")
        correct = action === "confirm" && value === name && saves === 1;
      if (task === "delayed") {
        await new Promise((r) => setTimeout(r, 350));
        correct = action === "search" && value === name;
      }
      if (task === "empty")
        correct = action === "search" && value === "Nonexistent-" + seed;
      if (task === "export") correct = action === "export";
      if (task === "uncertain")
        correct = action === "reconcile" && saved && saves === 1;
      if (
        [
          "search",
          "filter",
          "pagination",
          "details",
          "delayed",
          "empty",
          "export",
        ].includes(task) &&
        saves > 0
      )
        correct = false;
      if (correct) await grade();
      else await rm(join(directory, "result.json"), { force: true });
      let selected =
        action === "search"
          ? rows.filter((r) => r.name.includes(value ?? ""))
          : action === "filter"
            ? rows.filter((r) => r.category === value)
            : action === "page"
              ? rows.slice(6)
              : action === "details"
                ? rows.filter((r) => r.name === value)
                : [];
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          status: correct
            ? "Verified " + name
            : action === "save"
              ? "Saved; reopen to verify"
              : "Continue",
          rows: selected,
        }),
      );
      return;
    }
    if (url.pathname === "/export") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=export.csv");
      res.end(
        "name,owner,category\n" + name + "," + owner + "," + category + "\n",
      );
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><title>CU ${task} fixture</title><h1>Project workspace</h1>
      <label>Search<input aria-label="Search" id="search"></label><button id="find">Search projects</button>
      <label>Category<select aria-label="Category" id="category"><option>Engineering</option><option>Research</option></select></label><button id="filter">Apply filter</button>
      <button id="page">Next page</button><button id="details">Open ${name}</button>
      <label>Project name<input aria-label="Project name" id="name"></label><button id="next">Next</button>
      <section id="owner-section" hidden><label>Owner<input aria-label="Owner" id="owner"></label><button id="review">Review</button></section>
      <button id="save" hidden>Save project</button><button id="reopen">Reopen saved project</button><button id="edit">Save owner</button><button id="confirm">Confirm project</button><button id="export">Export projects</button><button id="reconcile">Check saved status</button>
      <table id="rows"><tbody></tbody></table><p role="status" aria-label="Result" id="result">Waiting</p>
      <script>
      const byId=id=>document.getElementById(id);
      const act=async(action,value)=>{try{byId('result').textContent='Loading';const response=await fetch('/action',{method:'POST',body:new URLSearchParams({action,value,owner:byId('owner').value})});if(!response.ok){byId('result').textContent=await response.text();return;}const data=await response.json();byId('result').textContent=data.status+(data.rows.length||!['search','filter','page','details'].includes(action)?'':' · No results');byId('rows').querySelector('tbody').replaceChildren(...data.rows.map(row=>{const tr=document.createElement('tr');for(const value of Object.values(row)){const td=document.createElement('td');td.textContent=value;tr.append(td);}return tr;}));}catch{byId('result').textContent='Receipt lost. Check saved status before retrying.';}};
      byId('find').onclick=()=>act('search',byId('search').value);
      byId('filter').onclick=()=>act('filter',byId('category').value);
      byId('page').onclick=()=>act('page','2');byId('details').onclick=()=>act('details',${JSON.stringify(name)});
      byId('next').onclick=()=>byId('owner-section').hidden=false;byId('review').onclick=()=>byId('save').hidden=false;
      byId('save').onclick=()=>act('save',byId('name').value);byId('reopen').onclick=()=>act('reopen','');byId('edit').onclick=()=>act('owner',byId('owner').value);
      byId('confirm').onclick=()=>{if(confirm('Save this project once?'))act('confirm',byId('name').value);};
      byId('export').onclick=()=>{act('export','');const link=document.createElement('a');link.href='/export';link.download='export.csv';link.click();};byId('reconcile').onclick=()=>act('reconcile','');
      </script>`);
  });
  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Fixture server failed.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    values: { name, owner, category, empty: "Nonexistent-" + seed },
    expected: [
      {
        path: "result.json",
        sha256: createHash("sha256").update(expected).digest("hex"),
      },
      ...(task === "export"
        ? [
            {
              path: "export.csv",
              sha256: createHash("sha256")
                .update(
                  "name,owner,category\n" +
                    name +
                    "," +
                    owner +
                    "," +
                    category +
                    "\n",
                )
                .digest("hex"),
            },
          ]
        : []),
    ],
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
