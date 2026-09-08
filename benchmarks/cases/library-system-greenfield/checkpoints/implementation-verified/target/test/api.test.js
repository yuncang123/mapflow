import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createLibraryServer } from "../src/server.js";

async function startTestServer(dataFile) {
  const server = createLibraryServer({ dataFile });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function post(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

test("serves the administrator workspace at the root URL", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "shelfwise-page-"));
  const app = await startTestServer(path.join(directory, "library.sqlite"));
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  const pageResponse = await fetch(`${app.baseUrl}/`);
  const page = await pageResponse.text();
  const styleResponse = await fetch(`${app.baseUrl}/styles.css`);
  const scriptResponse = await fetch(`${app.baseUrl}/app.js`);

  assert.equal(pageResponse.status, 200);
  assert.match(pageResponse.headers.get("content-type"), /^text\/html/);
  assert.match(page, /<title>Shelfwise · 社区图书室<\/title>/);
  assert.match(page, /当前借阅/);
  assert.match(page, /登记图书/);
  assert.match(page, /登记读者/);
  assert.match(page, /借书/);
  assert.equal(styleResponse.status, 200);
  assert.equal(scriptResponse.status, 200);
});

test("registers a book and reader with stable IDs", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "shelfwise-registration-"));
  const app = await startTestServer(path.join(directory, "library.sqlite"));
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  const book = await post(app.baseUrl, "/api/books", {
    title: "The Left Hand of Darkness",
    author: "Ursula K. Le Guin",
    isbn: "9780441478125",
  });
  const reader = await post(app.baseUrl, "/api/readers", {
    name: "Lin Mei",
    contact: "lin@example.test",
  });

  assert.equal(book.response.status, 201);
  assert.deepEqual(
    { id: book.body.book.id, title: book.body.book.title, author: book.body.book.author },
    { id: 1, title: "The Left Hand of Darkness", author: "Ursula K. Le Guin" },
  );
  assert.equal(reader.response.status, 201);
  assert.deepEqual(
    { id: reader.body.reader.id, name: reader.body.reader.name },
    { id: 1, name: "Lin Mei" },
  );
});

test("registers separate copies that share an ISBN", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "shelfwise-copies-"));
  const app = await startTestServer(path.join(directory, "library.sqlite"));
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  const first = await post(app.baseUrl, "/api/books", {
    title: "The Hobbit",
    author: "J.R.R. Tolkien",
    isbn: "9780547928227",
  });
  const second = await post(app.baseUrl, "/api/books", {
    title: "The Hobbit",
    author: "J.R.R. Tolkien",
    isbn: "9780547928227",
  });

  assert.deepEqual([first.response.status, second.response.status], [201, 201]);
  assert.deepEqual([first.body.book.id, second.body.book.id], [1, 2]);
});

test("checks out, lists, and returns a book", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "shelfwise-lifecycle-"));
  const app = await startTestServer(path.join(directory, "library.sqlite"));
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  const { body: { book } } = await post(app.baseUrl, "/api/books", { title: "Kindred" });
  const { body: { reader } } = await post(app.baseUrl, "/api/readers", { name: "Avery Chen" });

  const checkout = await post(app.baseUrl, "/api/loans", { bookId: book.id, readerId: reader.id });

  assert.equal(checkout.response.status, 201);
  assert.deepEqual(
    {
      status: checkout.body.loan.status,
      book: checkout.body.loan.book.title,
      reader: checkout.body.loan.reader.name,
    },
    { status: "active", book: "Kindred", reader: "Avery Chen" },
  );

  const activeResponse = await fetch(`${app.baseUrl}/api/loans?status=active`);
  const active = await activeResponse.json();
  const returned = await post(app.baseUrl, "/api/returns", { loanId: checkout.body.loan.id });
  const emptyResponse = await fetch(`${app.baseUrl}/api/loans?status=active`);
  const empty = await emptyResponse.json();

  assert.equal(activeResponse.status, 200);
  assert.deepEqual(active.loans.map((loan) => loan.id), [checkout.body.loan.id]);
  assert.equal(returned.response.status, 200);
  assert.equal(returned.body.loan.status, "returned");
  assert.equal(emptyResponse.status, 200);
  assert.deepEqual(empty.loans, []);
});

test("rejects invalid and repeated loan operations without changing active loans", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "shelfwise-rules-"));
  const app = await startTestServer(path.join(directory, "library.sqlite"));
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  const { body: { book } } = await post(app.baseUrl, "/api/books", { title: "Parable of the Sower" });
  const { body: { reader } } = await post(app.baseUrl, "/api/readers", { name: "Jordan Lee" });

  const missingBook = await post(app.baseUrl, "/api/loans", { bookId: 999, readerId: reader.id });
  const missingReader = await post(app.baseUrl, "/api/loans", { bookId: book.id, readerId: 999 });
  const firstLoan = await post(app.baseUrl, "/api/loans", { bookId: book.id, readerId: reader.id });
  const repeatedLoan = await post(app.baseUrl, "/api/loans", { bookId: book.id, readerId: reader.id });
  const activeResponse = await fetch(`${app.baseUrl}/api/loans?status=active`);
  const active = await activeResponse.json();
  const firstReturn = await post(app.baseUrl, "/api/returns", { loanId: firstLoan.body.loan.id });
  const repeatedReturn = await post(app.baseUrl, "/api/returns", { loanId: firstLoan.body.loan.id });
  const finalResponse = await fetch(`${app.baseUrl}/api/loans?status=active`);
  const final = await finalResponse.json();

  assert.deepEqual(
    [missingBook.response.status, missingBook.body.error.code],
    [404, "book_not_found"],
  );
  assert.deepEqual(
    [missingReader.response.status, missingReader.body.error.code],
    [404, "reader_not_found"],
  );
  assert.deepEqual(
    [repeatedLoan.response.status, repeatedLoan.body.error.code],
    [409, "book_already_loaned"],
  );
  assert.deepEqual(active.loans.map((loan) => loan.id), [firstLoan.body.loan.id]);
  assert.equal(firstReturn.response.status, 200);
  assert.deepEqual(
    [repeatedReturn.response.status, repeatedReturn.body.error.code],
    [409, "loan_already_returned"],
  );
  assert.deepEqual(final.loans, []);
});

test("preserves registrations and loan state across restarts", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "shelfwise-restart-"));
  const dataFile = path.join(directory, "library.sqlite");
  let app = await startTestServer(dataFile);
  t.after(async () => {
    if (app) {
      await app.close();
    }
    await rm(directory, { recursive: true, force: true });
  });

  const { body: { book } } = await post(app.baseUrl, "/api/books", { title: "A Wizard of Earthsea" });
  const { body: { reader } } = await post(app.baseUrl, "/api/readers", { name: "Morgan Yu" });
  const { body: { loan } } = await post(app.baseUrl, "/api/loans", {
    bookId: book.id,
    readerId: reader.id,
  });
  await app.close();
  app = null;

  app = await startTestServer(dataFile);
  const activeResponse = await fetch(`${app.baseUrl}/api/loans?status=active`);
  const active = await activeResponse.json();
  const secondBook = await post(app.baseUrl, "/api/books", { title: "The Dispossessed" });
  const secondReader = await post(app.baseUrl, "/api/readers", { name: "Sam Rivera" });

  assert.deepEqual(
    active.loans.map((item) => ({
      id: item.id,
      book: item.book.title,
      reader: item.reader.name,
      status: item.status,
    })),
    [{ id: loan.id, book: "A Wizard of Earthsea", reader: "Morgan Yu", status: "active" }],
  );
  assert.equal(secondBook.body.book.id, 2);
  assert.equal(secondReader.body.reader.id, 2);

  await post(app.baseUrl, "/api/returns", { loanId: loan.id });
  await app.close();
  app = null;

  app = await startTestServer(dataFile);
  const finalResponse = await fetch(`${app.baseUrl}/api/loans?status=active`);
  const final = await finalResponse.json();
  const repeatedReturn = await post(app.baseUrl, "/api/returns", { loanId: loan.id });

  assert.deepEqual(final.loans, []);
  assert.deepEqual(
    [repeatedReturn.response.status, repeatedReturn.body.error.code],
    [409, "loan_already_returned"],
  );
});
