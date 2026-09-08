import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Library } from "../src/library.mjs";

test("existing catalog and loan flow remains stable", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shelfwise-test-"));
  const file = path.join(directory, "data.json");
  const library = new Library(file);
  const book = library.addBook({ title: "活着", author: "余华", isbn: "9787506365437" });
  const reader = library.addReader({ name: "读者" });
  const loan = library.borrow({ bookId: book.id, readerId: reader.id });
  assert.equal(loan.status, "active");
  assert.equal(library.listLoans("active").length, 1);
  assert.equal(library.returnBook(book.id).status, "returned");
  assert.equal(new Library(file).listLoans("active").length, 0);
  fs.rmSync(directory, { recursive: true, force: true });
});
