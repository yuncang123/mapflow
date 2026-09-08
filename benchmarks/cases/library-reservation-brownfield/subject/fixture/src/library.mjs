import fs from "node:fs";
import path from "node:path";

export class Library {
  constructor(file) {
    this.file = file;
    this.data = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, "utf8"))
      : { books: [], readers: [], loans: [] };
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
  }

  addBook(input) {
    const book = { id: `book-${this.data.books.length + 1}`, title: input.title, author: input.author, isbn: input.isbn };
    this.data.books.push(book);
    this.save();
    return book;
  }

  addReader(input) {
    const reader = { id: `reader-${this.data.readers.length + 1}`, name: input.name };
    this.data.readers.push(reader);
    this.save();
    return reader;
  }

  borrow({ bookId, readerId }) {
    if (!this.data.books.some((book) => book.id === bookId)) throw new Error("book not found");
    if (!this.data.readers.some((reader) => reader.id === readerId)) throw new Error("reader not found");
    if (this.data.loans.some((loan) => loan.bookId === bookId && loan.status === "active")) throw new Error("book unavailable");
    const loan = { id: `loan-${this.data.loans.length + 1}`, bookId, readerId, status: "active" };
    this.data.loans.push(loan);
    this.save();
    return loan;
  }

  returnBook(bookId) {
    const loan = this.data.loans.find((entry) => entry.bookId === bookId && entry.status === "active");
    if (!loan) throw new Error("active loan not found");
    loan.status = "returned";
    this.save();
    return loan;
  }

  listLoans(status) {
    return status ? this.data.loans.filter((loan) => loan.status === status) : this.data.loans;
  }
}
