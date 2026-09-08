import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export class LibraryError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "LibraryError";
    this.status = status;
    this.code = code;
  }
}

function requiredText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new LibraryError(400, "validation_error", `${field} is required`);
  }
  return value.trim();
}

function optionalText(value, field) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new LibraryError(400, "validation_error", `${field} must be a string`);
  }
  return value.trim() || null;
}

function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new LibraryError(400, "validation_error", `${field} must be a positive integer`);
  }
  return value;
}

function toLoan(row) {
  return {
    id: row.id,
    bookId: row.bookId,
    readerId: row.readerId,
    borrowedAt: row.borrowedAt,
    returnedAt: row.returnedAt,
    status: row.returnedAt === null ? "active" : "returned",
    book: {
      id: row.bookId,
      title: row.bookTitle,
      author: row.bookAuthor,
    },
    reader: {
      id: row.readerId,
      name: row.readerName,
    },
  };
}

export function openLibrary(dataFile) {
  mkdirSync(path.dirname(dataFile), { recursive: true });
  const database = new DatabaseSync(dataFile);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT,
      isbn TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS readers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS loans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL REFERENCES books(id),
      reader_id INTEGER NOT NULL REFERENCES readers(id),
      borrowed_at TEXT NOT NULL,
      returned_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS one_active_loan_per_book
      ON loans(book_id) WHERE returned_at IS NULL;
  `);

  const insertBook = database.prepare(`
    INSERT INTO books (title, author, isbn, created_at)
    VALUES (?, ?, ?, ?)
    RETURNING id, title, author, isbn, created_at AS createdAt
  `);
  const insertReader = database.prepare(`
    INSERT INTO readers (name, contact, created_at)
    VALUES (?, ?, ?)
    RETURNING id, name, contact, created_at AS createdAt
  `);
  const findBook = database.prepare("SELECT id FROM books WHERE id = ?");
  const findReader = database.prepare("SELECT id FROM readers WHERE id = ?");
  const findActiveLoanByBook = database.prepare(
    "SELECT id FROM loans WHERE book_id = ? AND returned_at IS NULL",
  );
  const insertLoan = database.prepare(`
    INSERT INTO loans (book_id, reader_id, borrowed_at)
    VALUES (?, ?, ?)
    RETURNING id
  `);
  const findLoan = database.prepare(`
    SELECT
      l.id,
      l.book_id AS bookId,
      l.reader_id AS readerId,
      l.borrowed_at AS borrowedAt,
      l.returned_at AS returnedAt,
      b.title AS bookTitle,
      b.author AS bookAuthor,
      r.name AS readerName
    FROM loans l
    JOIN books b ON b.id = l.book_id
    JOIN readers r ON r.id = l.reader_id
    WHERE l.id = ?
  `);
  const listActiveLoans = database.prepare(`
    SELECT
      l.id,
      l.book_id AS bookId,
      l.reader_id AS readerId,
      l.borrowed_at AS borrowedAt,
      l.returned_at AS returnedAt,
      b.title AS bookTitle,
      b.author AS bookAuthor,
      r.name AS readerName
    FROM loans l
    JOIN books b ON b.id = l.book_id
    JOIN readers r ON r.id = l.reader_id
    WHERE l.returned_at IS NULL
    ORDER BY l.borrowed_at, l.id
  `);
  const markLoanReturned = database.prepare(
    "UPDATE loans SET returned_at = ? WHERE id = ? AND returned_at IS NULL",
  );

  function transaction(work) {
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    createBook(input) {
      const title = requiredText(input.title, "title");
      const author = optionalText(input.author, "author");
      const isbn = optionalText(input.isbn, "isbn");
      return insertBook.get(title, author, isbn, new Date().toISOString());
    },

    createReader(input) {
      const name = requiredText(input.name, "name");
      const contact = optionalText(input.contact, "contact");
      return insertReader.get(name, contact, new Date().toISOString());
    },

    createLoan(input) {
      const bookId = positiveInteger(input.bookId, "bookId");
      const readerId = positiveInteger(input.readerId, "readerId");

      return transaction(() => {
        if (!findBook.get(bookId)) {
          throw new LibraryError(404, "book_not_found", "Book not found");
        }
        if (!findReader.get(readerId)) {
          throw new LibraryError(404, "reader_not_found", "Reader not found");
        }
        if (findActiveLoanByBook.get(bookId)) {
          throw new LibraryError(409, "book_already_loaned", "Book is already on loan");
        }

        const { id } = insertLoan.get(bookId, readerId, new Date().toISOString());
        return toLoan(findLoan.get(id));
      });
    },

    listActiveLoans() {
      return listActiveLoans.all().map(toLoan);
    },

    returnLoan(input) {
      const loanId = positiveInteger(input.loanId, "loanId");

      return transaction(() => {
        const loan = findLoan.get(loanId);
        if (!loan) {
          throw new LibraryError(404, "loan_not_found", "Loan not found");
        }
        if (loan.returnedAt !== null) {
          throw new LibraryError(409, "loan_already_returned", "Loan has already been returned");
        }

        markLoanReturned.run(new Date().toISOString(), loanId);
        return toLoan(findLoan.get(loanId));
      });
    },

    close() {
      database.close();
    },
  };
}
