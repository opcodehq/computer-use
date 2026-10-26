export const browserTasks = [
  ["search", "Find the exact matching project using Search."],
  ["filter", "Filter projects to the requested category and verify every row."],
  [
    "pagination",
    "Read the project on the second page without repeating page one.",
  ],
  ["details", "Open the requested project and read its identifier and owner."],
  ["create", "Create a project and reopen its saved details."],
  ["edit", "Change the requested project owner and verify persisted details."],
  [
    "validation",
    "Recover from a rejected form value and save the corrected input.",
  ],
  ["dialog", "Save through the confirmation dialog exactly once."],
  ["delayed", "Wait for delayed results and return the requested project."],
  ["empty", "Search for a nonexistent project and verify zero results."],
  ["export", "Export the matching projects and verify the downloaded CSV."],
  [
    "uncertain",
    "Submit a project once, reconcile the saved result if the receipt is lost.",
  ],
] as const;
export const nativeTasks = [
  [
    "text",
    "Create a text document with the supplied content, save it, and reopen it.",
  ],
  [
    "files",
    "Create a folder, copy the supplied file into it, and rename the copy.",
  ],
  [
    "find",
    "Find the supplied document in the file manager and open it in the editor.",
  ],
  [
    "archive",
    "Extract the supplied ZIP using the archive application and open its text file.",
  ],
  [
    "sheet",
    "Open the supplied CSV in a spreadsheet, filter its category, and export the matching rows.",
  ],
  [
    "preference",
    "Change the fixture app setting, close the dialog, and reopen it to verify.",
  ],
  [
    "save-dialog",
    "Save a supplied document under the requested name using the Save As dialog.",
  ],
  [
    "terminal",
    "Enter the supplied harmless command in the terminal and capture its output in a saved text document.",
  ],
] as const;
export const crossTasks = [
  [
    "browser-sheet",
    "Download the browser export, open it in the spreadsheet, and save the requested report.",
  ],
  [
    "attachment",
    "Save a native document and upload that file through the browser attachment form.",
  ],
  [
    "report",
    "Read the requested browser records and assemble a saved text report in the editor.",
  ],
  [
    "reopen",
    "Download the requested report, rename it in the file manager, and reopen it in the editor.",
  ],
] as const;
export const catalog = [
  ...browserTasks.map(([id, instruction]) => ({
    id: "browser-" + id,
    suite: "browser",
    instruction,
  })),
  ...nativeTasks.map(([id, instruction]) => ({
    id: "native-" + id,
    suite: "native",
    instruction,
  })),
  ...crossTasks.map(([id, instruction]) => ({
    id: "cross-" + id,
    suite: "cross",
    instruction,
  })),
];
